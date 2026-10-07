import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { DbClient } from '../../../database/db-client';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { OutboxJobType, OutboxService, PermanentJobError, sanitizeError } from '../../jobs';
import {
  MembershipRecord,
  MembershipsRepository,
  hashCardToken,
  looksLikeCardToken,
} from '../../memberships';
import type { MerchantActor } from '../../tenancy';
import { WalletProviders } from '../adapters/wallet-providers';
import { AddLink, WalletProviderError, isApplePassRenderer } from '../adapters/wallet-provider';
import {
  deriveAppleAuthToken,
  hashBarcode,
  deriveBarcode,
  safeEqual,
  verifyLinkToken,
} from '../domain/credentials';
import type { PassState, WalletProviderKey } from '../domain/pass-state';
import { PassRow, WalletPassesRepository } from '../infrastructure/wallet-passes.repository';
import { PassStateBuilder } from './pass-state.builder';

const cardNotFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Card not found.', 404);
const passNotFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Pass not found.', 404);

/** A provider failure on a request path: tell the customer to retry, reveal nothing else. */
const providerDown = () =>
  new DomainError(
    'WALLET_PROVIDER_UNAVAILABLE',
    'The wallet service is unavailable. Please try again shortly.',
    502,
  );

export interface WebCardView {
  merchant: { nameEn: string; nameAm: string | null };
  program: {
    nameEn: string;
    nameAm: string | null;
    brandColor: string | null;
    termsEn: string;
    termsAm: string | null;
  };
  customer: { firstName: string | null; preferredLanguage: 'EN' | 'AM' };
  progress: { current: number; required: number; remaining: number; completedCards: number };
  rewardsAvailable: number;
  reward: {
    nameEn: string;
    nameAm: string | null;
    descriptionEn: string;
    descriptionAm: string | null;
  } | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVALIDATED' | 'PENDING';
  /** The value to show as the QR code: the customer's own card token. */
  barcode: string;
  version: number;
}

/**
 * Provider-neutral wallet orchestration: creates passes, hands out add-to-wallet links, renders Apple
 * passes on demand, delivers updates (called by the outbox worker, never inside a stamp transaction),
 * and revokes passes.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly providers: WalletProviders,
    private readonly passes: WalletPassesRepository,
    private readonly states: PassStateBuilder,
    private readonly memberships: MembershipsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  private get secret(): string | undefined {
    return this.providers.barcodeSecret;
  }

  // ───────────────────────── Customer-facing (the card token is the credential) ─────────────────────────

  /** Add-to-wallet link or download for the customer's own card. */
  async addLinkForCard(
    cardToken: string,
    provider: WalletProviderKey,
  ): Promise<AddLink & { provider: WalletProviderKey }> {
    const membership = await this.membershipForCard(cardToken);
    const adapter = this.providers.require(provider);
    try {
      const pass = await this.ensurePass(membership, provider);
      const state = await this.states.build(pass, this.secret);
      const link = await adapter.addLink(
        { passId: pass.id, providerPassId: pass.providerPassId },
        state,
      );
      return { provider, ...link };
    } catch (err) {
      if (err instanceof WalletProviderError) throw providerDown();
      throw err;
    }
  }

  /** Live web card: the same data a wallet pass shows, for the browser fallback. */
  async webCard(cardToken: string): Promise<WebCardView> {
    const membership = await this.membershipForCard(cardToken);
    const pass = await this.ensurePass(membership, 'WEB');
    const s = await this.states.build(pass, this.secret);
    return {
      merchant: { nameEn: s.merchantName.en, nameAm: s.merchantName.am },
      program: {
        nameEn: s.programName.en,
        nameAm: s.programName.am,
        brandColor: s.brandColor,
        termsEn: s.terms.en,
        termsAm: s.terms.am,
      },
      customer: { firstName: s.firstName, preferredLanguage: s.language },
      progress: {
        current: s.currentStamps,
        required: s.stampsRequired,
        remaining: s.stampsRequired - s.currentStamps,
        completedCards: s.completedCards,
      },
      rewardsAvailable: s.rewardsAvailable,
      reward: s.reward && {
        nameEn: s.reward.name.en,
        nameAm: s.reward.name.am,
        descriptionEn: s.reward.description.en,
        descriptionAm: s.reward.description.am,
      },
      status: s.status,
      barcode: cardToken,
      version: s.version,
    };
  }

  // ───────────────────────── Apple pull endpoints ─────────────────────────

  /** Pass for a download link (short-lived signed token) or null. */
  async passForDownload(passId: string, linkToken: string): Promise<PassRow | null> {
    if (!this.secret || !verifyLinkToken(this.secret, passId, linkToken, new Date())) return null;
    return this.appleLivePass(passId);
  }

  /** Pass for Apple's web service: authenticated with the per-pass "ApplePass <token>" header. */
  async passForAppleAuth(
    passId: string,
    authorization: string | undefined,
  ): Promise<PassRow | null> {
    const token = /^ApplePass (.+)$/.exec(authorization ?? '')?.[1];
    if (!this.secret || !token) return null;
    if (!safeEqual(token, deriveAppleAuthToken(this.secret, passId))) return null;
    return this.appleLivePass(passId);
  }

  private async appleLivePass(passId: string): Promise<PassRow | null> {
    const pass = await this.passes.findAnyTenantById(passId);
    return pass && pass.provider === 'APPLE' ? pass : null;
  }

  /** The current .pkpass (or the fake's JSON) for a pass. Voided when suspended or invalidated. */
  async renderApplePass(
    pass: PassRow,
  ): Promise<{ body: Buffer; contentType: string; lastModified: Date }> {
    const adapter = this.providers.get('APPLE');
    if (!adapter || !isApplePassRenderer(adapter)) throw passNotFound();
    try {
      const state = await this.states.build(pass, this.secret);
      const out = await adapter.renderPass(state);
      return { ...out, lastModified: pass.updatedAt };
    } catch (err) {
      if (err instanceof WalletProviderError) throw providerDown();
      throw err;
    }
  }

  // ───────────────────────── Delivery (outbox worker) ─────────────────────────

  /**
   * Brings every stale pass of one membership up to date. Safe to call repeatedly: each pass is only
   * touched when it owes the provider something, and what is sent is always the CURRENT ledger state.
   * One provider failing does not stop the others. If anything failed the error is rethrown so the
   * outbox retries with backoff; the loyalty event that triggered it is long since committed.
   */
  async syncMembership(
    merchantId: string,
    membershipId: string,
  ): Promise<{ delivered: number; skipped: number }> {
    const stale = await this.passes.listStale(merchantId, membershipId);
    let delivered = 0;
    let skipped = 0;
    const failures: unknown[] = [];

    for (const pass of stale) {
      const adapter = this.providers.get(pass.provider);
      if (!adapter) {
        skipped++; // provider switched off: leave the pass stale for when it is back
        continue;
      }
      try {
        if (pass.status === 'PENDING') {
          await this.register(pass);
        } else {
          const state = await this.states.build(pass, this.secret);
          const ref = { passId: pass.id, providerPassId: pass.providerPassId };
          if (state.status === 'ACTIVE' || state.status === 'PENDING')
            await adapter.updatePass(ref, state);
          else await adapter.suspendPass(ref, state);
          await this.passes.markSynced(pass.id, pass.passVersion);
        }
        delivered++;
      } catch (err) {
        await this.passes.markFailed(pass.id, sanitizeError(err));
        failures.push(err);
      }
    }

    if (failures.length > 0) {
      const summary = `${failures.length} wallet pass update(s) failed: ${sanitizeError(failures[0])}`;
      const retryable = failures.some((e) =>
        e instanceof WalletProviderError ? e.retryable : !(e instanceof DomainError),
      );
      throw retryable ? new Error(summary) : new PermanentJobError(summary);
    }
    return { delivered, skipped };
  }

  // ───────────────────────── Staff operations ─────────────────────────

  async listPasses(actor: MerchantActor, membershipId: string): Promise<PassRow[]> {
    const membership = await this.memberships.findById(actor.merchantId, membershipId);
    if (!membership) throw new DomainError(ErrorCode.NOT_FOUND, 'Membership not found.', 404);
    return this.passes.listForMembership(actor.merchantId, membershipId);
  }

  /**
   * Revokes every Apple and Google pass of a membership (lost or stolen phone). The pass rows are kept for
   * history, their barcodes stop being accepted at once, and wallets are told to void them. The web card
   * and card token are unaffected; the customer can add a fresh pass afterwards.
   */
  async invalidatePasses(
    actor: MerchantActor,
    membershipId: string,
    meta: RequestMeta,
  ): Promise<number> {
    return this.transactions.run(async (db) => {
      const membership = await this.memberships.lockById(actor.merchantId, membershipId, db);
      if (!membership) throw new DomainError(ErrorCode.NOT_FOUND, 'Membership not found.', 404);
      const live = (await this.passes.listForMembership(actor.merchantId, membershipId, db)).filter(
        (p) => p.provider !== 'WEB' && p.status !== 'INVALIDATED',
      );
      for (const pass of live) await this.passes.setStatus(pass.id, 'INVALIDATED', db);
      if (live.length > 0) {
        await this.outbox.enqueue(
          {
            merchantId: actor.merchantId,
            type: OutboxJobType.WALLET_PASS_UPDATE,
            aggregateType: 'membership',
            aggregateId: membershipId,
            payload: { reason: 'passes_invalidated' },
          },
          db,
        );
      }
      await this.audit.record(
        {
          action: 'wallet.passes_invalidated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'membership',
          targetId: membershipId,
          requestId: meta.requestId,
          metadata: { passes: live.length, providers: live.map((p) => p.provider) },
        },
        db,
      );
      return live.length;
    });
  }

  /**
   * Revokes EVERY pass of a membership, web card included, inside the caller's transaction (used when a
   * customer is anonymized). Barcodes stop working at once, device registrations are forgotten, and the
   * wallets are told to void the cards. Returns how many passes were revoked.
   */
  async revokeAllForMembership(
    merchantId: string,
    membershipId: string,
    db: DbClient,
  ): Promise<number> {
    const live = (await this.passes.listForMembership(merchantId, membershipId, db)).filter(
      (p) => p.status !== 'INVALIDATED',
    );
    for (const pass of live) {
      await this.passes.setStatus(pass.id, 'INVALIDATED', db);
      await this.passes.deleteRegistrationsForPass(pass.id, db);
    }
    if (live.length > 0) {
      await this.outbox.enqueue(
        {
          merchantId,
          type: OutboxJobType.WALLET_PASS_UPDATE,
          aggregateType: 'membership',
          aggregateId: membershipId,
          payload: { reason: 'customer_anonymized' },
        },
        db,
      );
    }
    return live.length;
  }

  /** Forces a pass to be re-delivered (support tool). */
  async resync(actor: MerchantActor, passId: string, meta: RequestMeta): Promise<void> {
    await this.transactions.run(async (db) => {
      const pass = await this.passes.findById(actor.merchantId, passId, db);
      if (!pass) throw passNotFound();
      await this.passes.bumpVersion(pass.id, db);
      await this.outbox.enqueue(
        {
          merchantId: actor.merchantId,
          type: OutboxJobType.WALLET_PASS_UPDATE,
          aggregateType: 'membership',
          aggregateId: pass.membershipId,
          payload: { reason: 'manual_resync', passId: pass.id },
        },
        db,
      );
      await this.audit.record(
        {
          action: 'wallet.pass_resync_requested',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'wallet_pass',
          targetId: pass.id,
          requestId: meta.requestId,
          metadata: { provider: pass.provider },
        },
        db,
      );
    });
  }

  // ───────────────────────── Internals ─────────────────────────

  private async membershipForCard(cardToken: string): Promise<MembershipRecord> {
    if (!looksLikeCardToken(cardToken)) throw cardNotFound();
    const membership = await this.memberships.findByTokenHash(hashCardToken(cardToken));
    if (!membership || membership.status !== 'ACTIVE') throw cardNotFound();
    return membership;
  }

  /** The live pass for this provider, created (and registered with the provider) on first use. */
  private async ensurePass(
    membership: MembershipRecord,
    provider: WalletProviderKey,
  ): Promise<PassRow> {
    const { merchantId, id: membershipId } = membership;
    let pass = await this.passes.findLive(merchantId, membershipId, provider);
    if (!pass) {
      const id = randomUUID();
      try {
        pass = await this.passes.create({
          id,
          merchantId,
          membershipId,
          provider,
          barcodeHash:
            provider !== 'WEB' && this.secret
              ? hashBarcode(deriveBarcode(this.secret, id, 1))
              : null,
        });
      } catch (err) {
        // A concurrent request created it first (partial unique index): use theirs.
        if ((err as { code?: string }).code !== 'P2002') throw err;
        pass = await this.passes.findLive(merchantId, membershipId, provider);
        if (!pass) throw err;
      }
    }
    if (pass.status === 'PENDING') pass = await this.register(pass);
    return pass;
  }

  /** Creates the pass at the provider. A failure leaves the row PENDING so a later attempt can finish it. */
  private async register(pass: PassRow): Promise<PassRow> {
    const adapter = this.providers.require(pass.provider);
    const state = await this.states.build(pass, this.secret);
    try {
      const { providerPassId } = await adapter.createPass(state);
      await this.passes.markCreated(pass.id, providerPassId, pass.passVersion);
    } catch (err) {
      await this.passes.markFailed(pass.id, sanitizeError(err));
      throw err;
    }
    await this.audit.record({
      action: 'wallet.pass_created',
      actorType: 'SYSTEM',
      merchantId: pass.merchantId,
      targetType: 'wallet_pass',
      targetId: pass.id,
      metadata: { provider: pass.provider, membershipId: pass.membershipId },
    });
    return (await this.passes.findById(pass.merchantId, pass.id)) as PassRow;
  }

  /** Exposed for tests and tooling. */
  buildState(pass: PassRow): Promise<PassState> {
    return this.states.build(pass, this.secret);
  }
}
