import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { DbClient } from '../../../database/db-client';
import { TransactionManager } from '../../../database/transaction-manager';
import { AuditService } from '../../audit';
import { MerchantDirectory } from '../../merchants';
import type { MerchantActor } from '../../tenancy';
import { ProgramAction, ProgramStatus, transition } from '../domain/program-lifecycle';
import {
  ProgramFields,
  ProgramRecord,
  ProgramsRepository,
  RewardFields,
} from '../infrastructure/programs.repository';

export interface CreateProgramInput extends ProgramFields {
  nameEn: string;
  reward: RewardFields & { nameEn: string };
}

export interface UpdateProgramInput extends ProgramFields {
  reward?: RewardFields;
}

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Program not found.', 404);
const conflict = (code: string, message: string) => new DomainError(code, message, 409);

const clean = (v: string | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : v.trim() === '' ? null : v.trim();

@Injectable()
export class ProgramsService {
  constructor(
    private readonly repository: ProgramsRepository,
    private readonly directory: MerchantDirectory,
    private readonly audit: AuditService,
    private readonly transactions: TransactionManager,
  ) {}

  list(actor: MerchantActor, status?: ProgramStatus): Promise<ProgramRecord[]> {
    return this.repository.list(actor.merchantId, status);
  }

  async get(actor: MerchantActor, id: string): Promise<ProgramRecord> {
    const program = await this.repository.findById(actor.merchantId, id);
    if (!program) throw notFound();
    return program;
  }

  /** New programs start as DRAFT with exactly one active reward definition. */
  async create(
    actor: MerchantActor,
    input: CreateProgramInput,
    meta: RequestMeta,
  ): Promise<ProgramRecord> {
    const defaults = await this.directory.programDefaults(actor.merchantId);
    return this.transactions.run(async (db) => {
      const id = await this.repository.create(
        actor.merchantId,
        {
          nameEn: input.nameEn.trim(),
          nameAm: clean(input.nameAm),
          termsEn: clean(input.termsEn),
          termsAm: clean(input.termsAm),
          brandColor: input.brandColor?.toUpperCase(),
          cardDisplay: input.cardDisplay,
          stampsRequired: input.stampsRequired ?? defaults.stampsRequired,
          cooldownMinutes: input.cooldownMinutes ?? defaults.cooldownMinutes,
        },
        {
          nameEn: input.reward.nameEn.trim(),
          nameAm: clean(input.reward.nameAm),
          descriptionEn: clean(input.reward.descriptionEn),
          descriptionAm: clean(input.reward.descriptionAm),
          validForDays: input.reward.validForDays,
        },
        db,
      );
      await this.audit.record(
        {
          action: 'program.created',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'loyalty_program',
          targetId: id,
          requestId: meta.requestId,
        },
        db,
      );
      return (await this.repository.findById(actor.merchantId, id, db)) as ProgramRecord;
    });
  }

  /**
   * Partial update. Content (names, terms, colours, card display, reward text) is always editable
   * until the program is archived. The stamp threshold is locked once any customer is enrolled,
   * because every member's progress is derived from it.
   */
  async update(
    actor: MerchantActor,
    id: string,
    input: UpdateProgramInput,
    meta: RequestMeta,
  ): Promise<ProgramRecord> {
    return this.transactions.run(async (db) => {
      await this.repository.lockAll(actor.merchantId, db);
      const current = await this.repository.findById(actor.merchantId, id, db);
      if (!current) throw notFound();
      if (current.status === 'ARCHIVED') {
        throw conflict('PROGRAM_ARCHIVED', 'Archived programs cannot be changed.');
      }

      const program: ProgramFields = {};
      const changed: string[] = [];
      const take = <K extends keyof ProgramFields>(key: K, value: ProgramFields[K]) => {
        if (value === undefined) return;
        const existing = current[key as keyof ProgramRecord];
        if (JSON.stringify(existing) !== JSON.stringify(value)) {
          program[key] = value;
          changed.push(key);
        }
      };
      take('nameEn', input.nameEn?.trim());
      take('nameAm', clean(input.nameAm));
      take('termsEn', clean(input.termsEn));
      take('termsAm', clean(input.termsAm));
      take('stampsRequired', input.stampsRequired);
      take('cooldownMinutes', input.cooldownMinutes);
      take('brandColor', input.brandColor === null ? null : input.brandColor?.toUpperCase());
      take('cardDisplay', input.cardDisplay);

      if (program.stampsRequired !== undefined && current.membershipCount > 0) {
        throw conflict(
          'PROGRAM_LOCKED',
          'The stamp requirement cannot change after customers have joined, because it would alter their progress. Create a new program instead.',
        );
      }

      const reward: RewardFields = {};
      if (input.reward && current.reward) {
        const r = input.reward;
        const set = <K extends keyof RewardFields>(key: K, value: RewardFields[K]) => {
          if (value !== undefined && value !== current.reward?.[key]) {
            reward[key] = value;
            changed.push(`reward.${key}`);
          }
        };
        set('nameEn', r.nameEn?.trim());
        set('nameAm', clean(r.nameAm));
        set('descriptionEn', clean(r.descriptionEn));
        set('descriptionAm', clean(r.descriptionAm));
        set('validForDays', r.validForDays);
      }

      if (changed.length === 0) return current;
      if (Object.keys(program).length > 0) {
        await this.repository.update(actor.merchantId, id, program, db);
      }
      if (Object.keys(reward).length > 0 && current.reward) {
        await this.repository.updateReward(actor.merchantId, id, current.reward.id, reward, db);
      }
      await this.audit.record(
        {
          action: 'program.updated',
          actorUserId: actor.userId,
          merchantId: actor.merchantId,
          targetType: 'loyalty_program',
          targetId: id,
          requestId: meta.requestId,
          metadata: { changedFields: changed },
        },
        db,
      );
      return (await this.repository.findById(actor.merchantId, id, db)) as ProgramRecord;
    });
  }

  activate(actor: MerchantActor, id: string, meta: RequestMeta) {
    return this.changeStatus(actor, id, 'activate', meta);
  }
  pause(actor: MerchantActor, id: string, meta: RequestMeta) {
    return this.changeStatus(actor, id, 'pause', meta);
  }
  archive(actor: MerchantActor, id: string, meta: RequestMeta) {
    return this.changeStatus(actor, id, 'archive', meta);
  }

  private async changeStatus(
    actor: MerchantActor,
    id: string,
    action: ProgramAction,
    meta: RequestMeta,
  ): Promise<ProgramRecord> {
    try {
      return await this.transactions.run((db) => this.applyStatus(actor, id, action, meta, db));
    } catch (err) {
      // Backstop for the "one default ACTIVE program" index; the lock normally prevents this.
      if ((err as { code?: string }).code === 'P2002') {
        throw conflict('DEFAULT_PROGRAM_EXISTS', 'Another program is already the active default.');
      }
      throw err;
    }
  }

  private async applyStatus(
    actor: MerchantActor,
    id: string,
    action: ProgramAction,
    meta: RequestMeta,
    db: DbClient,
  ): Promise<ProgramRecord> {
    const all = await this.repository.lockAll(actor.merchantId, db);
    const program = await this.repository.findById(actor.merchantId, id, db);
    if (!program) throw notFound();

    const next = transition(program.status, action);
    if (next === null) {
      throw conflict(
        'INVALID_TRANSITION',
        `A ${program.status.toLowerCase()} program cannot be ${action}d.`,
      );
    }
    if (next === 'NOOP') return program;

    if (action === 'activate') {
      if (!program.reward) {
        throw conflict(
          'PROGRAM_INCOMPLETE',
          'A program needs an active reward before it can be activated.',
        );
      }
      if (all.some((p) => p.id !== id && p.status === 'ACTIVE' && p.isDefault)) {
        throw conflict(
          'DEFAULT_PROGRAM_EXISTS',
          'Another program is already the active default. Pause or archive it first.',
        );
      }
    }
    const isDefault =
      action === 'activate' ? true : action === 'archive' ? false : program.isDefault;
    await this.repository.setStatus(actor.merchantId, id, next, isDefault, db);
    await this.audit.record(
      {
        action: `program.${next === 'ACTIVE' ? 'activated' : next === 'PAUSED' ? 'paused' : 'archived'}`,
        actorUserId: actor.userId,
        merchantId: actor.merchantId,
        targetType: 'loyalty_program',
        targetId: id,
        requestId: meta.requestId,
        metadata: { from: program.status, to: next, members: program.membershipCount },
      },
      db,
    );
    return (await this.repository.findById(actor.merchantId, id, db)) as ProgramRecord;
  }
}
