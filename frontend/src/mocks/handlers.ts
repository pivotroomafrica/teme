/**
 * Mock backend behaviour. It follows backend/docs (authentication, loyalty-and-enrollment, scanner-and-stamps,
 * rewards-and-reversals, wallet-passes) and uses magic input values to reach every state without a server.
 * The table of magic values is in src/mocks/README.md.
 *
 * ASSUMPTIONS to reconcile with the live backend (Prompt 15): the rejection message wording, the exact
 * detail strings of validation errors, and the retry-after values below are plausible stand-ins.
 */
import {
  campaignsFor,
  cancelCampaign,
  createCampaign,
  listCampaigns,
  sendCampaign,
  type CampaignStore,
} from "./campaigns-data";
import {
  anonymize as anonymizeCustomer,
  customerData,
  getRetention,
  invalidatePasses,
  reissueCard,
  resyncPass,
  runRetention,
  setMembershipStatus,
  setRetention,
  withdrawConsent,
} from "./privacy-data";
import {
  evaluate as evaluateFraud,
  fraudFor,
  listFlags,
  reviewFlag,
  updateThresholds,
  type FraudStore,
} from "./fraud-data";
import { profileFor, updateProfile, type ProfileStore } from "./settings-data";
import {
  deadJobs,
  listMerchants,
  opsFor,
  outboxStats,
  platformAudit,
  requeueDead,
  type OpsStores,
} from "./ops-data";
import {
  auditList,
  listCustomers,
  membershipLedger,
  membershipPasses,
  membershipSummary,
  recordsFor,
  reverse,
  type RecordsStore,
} from "./records-data";
import {
  MOCK_DEFINITIONS,
  branchesFor,
  cohortsFor,
  staffFor,
  monthlyReturningFor,
  overviewFor,
  resolveMockRange,
  walletFor,
} from "./analytics-data";
import type { MockContext, MockReply, MockRoute } from "./mock-transport";
import {
  acceptInvitation,
  changeRole,
  createBranch,
  inviteStaff,
  orgFor,
  reissueInvitation,
  setBranchStatus,
  setStaffBranches,
  setStaffStatus,
  staffActivity,
  updateBranch,
  visibleBranches,
  type OrgStore,
} from "./org-data";
import {
  changeStatus,
  createProgram,
  programsFor,
  updateProgram,
  type ProgramStore,
} from "./program-data";
import {
  MOCK_ACCOUNTS,
  MOCK_BRANCHES,
  MOCK_CONSENT_VERSION,
  MOCK_JOIN_INFO,
  MOCK_PASSWORD,
  REJECTION_MESSAGES,
  accessTokenFor,
  meFor,
  refreshTokenFor,
  sessionFor,
  webCardFor,
  type MockEmail,
} from "./fixtures";
import type { RedeemResult, RejectionReason, ScanResult } from "@/lib/api/contract";

interface CardState {
  stamps: number;
  rewards: number;
  status: "ACTIVE" | "SUSPENDED" | "INVALIDATED" | "PENDING";
  cooldown: boolean;
  firstName: string;
}

export interface MockState {
  cards: Map<string, CardState>;
  idempotency: Map<string, { fingerprint: string; reply: MockReply }>;
  refreshTokens: Map<string, MockEmail>;
  /** Refresh tokens that were used or revoked: presenting one again is rejected (reuse detection). */
  revokedRefresh: Set<string>;
  refreshCounter: Map<MockEmail, number>;
  enrolledPhones: Set<string>;
  /** Web card loads seen per token, for the "mock-flaky" card that works for the claim and the first page view, then fails. */
  cardLoads: Map<string, number>;
  /** Programs per mock account (see program-data.ts). */
  programs: ProgramStore;
  /** Branches and team per mock account (see org-data.ts). */
  orgs: OrgStore;
  /** Customers, ledgers and audit history per mock account (see records-data.ts). */
  records: RecordsStore;
  /** Platform operations data (see ops-data.ts). */
  ops: OpsStores;
  /** Business profile per mock account (see settings-data.ts). */
  profiles: ProfileStore;
  /** Fraud flags and thresholds per mock account (see fraud-data.ts). */
  fraud: FraudStore;
  /** Proposed campaigns per mock account (see campaigns-data.ts). */
  campaigns: CampaignStore;
  nextCard: number;
}

export function createMockState(): MockState {
  return {
    cards: new Map(),
    idempotency: new Map(),
    refreshTokens: new Map(),
    revokedRefresh: new Set(),
    refreshCounter: new Map(),
    enrolledPhones: new Set(),
    cardLoads: new Map(),
    programs: new Map(),
    orgs: new Map(),
    records: new Map(),
    ops: new Map(),
    profiles: new Map(),
    fraud: new Map(),
    campaigns: new Map(),
    nextCard: 1,
  };
}

const REQUIRED = MOCK_JOIN_INFO.program.stampsRequired;

const error = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Record<string, string>,
): MockReply => ({
  status,
  body: {
    error: {
      code,
      message,
      details,
      requestId: "mock-request",
      timestamp: new Date().toISOString(),
    },
  },
  headers,
});
const ok = (body: unknown): MockReply => ({ status: 200, body });
const noContent = (): MockReply => ({ status: 204 });
const fromReply = (reply: { status: number; body: unknown }): MockReply => reply;

const isMockEmail = (value: unknown): value is MockEmail =>
  typeof value === "string" && value in MOCK_ACCOUNTS;

function authenticate(
  ctx: MockContext,
  permission?: string,
): { email: MockEmail } | { reply: MockReply } {
  const prefix = "mock-access.";
  const email = ctx.token?.startsWith(prefix) ? ctx.token.slice(prefix.length) : undefined;
  if (!isMockEmail(email))
    return { reply: error(401, "UNAUTHENTICATED", "Authentication required.") };
  if (permission && !(MOCK_ACCOUNTS[email].permissions as readonly string[]).includes(permission)) {
    return { reply: error(403, "FORBIDDEN", "You do not have permission to do this.") };
  }
  return { email };
}

/** Cards by token prefix; see README for the list. Unknown tokens are not cards of this merchant. */
function cardFor(state: MockState, token: unknown): CardState | undefined {
  if (typeof token !== "string") return undefined;
  const existing = state.cards.get(token);
  if (existing) return existing;
  const base = { status: "ACTIVE" as const, cooldown: false, firstName: "Abebe" };
  let card: CardState | undefined;
  if (token.startsWith("mock-ok-")) card = { ...base, stamps: 2, rewards: 0 };
  else if (token.startsWith("mock-almost")) card = { ...base, stamps: REQUIRED - 1, rewards: 0 };
  else if (token.startsWith("mock-reward")) card = { ...base, stamps: REQUIRED, rewards: 1 };
  else if (token.startsWith("mock-cooldown"))
    card = { ...base, stamps: 3, rewards: 0, cooldown: true };
  else if (token.startsWith("mock-inactive"))
    card = { ...base, stamps: 3, rewards: 0, status: "SUSPENDED" };
  else if (typeof token === "string" && token.startsWith("mock-flaky"))
    card = { ...base, stamps: 2, rewards: 0 };
  else if (token === "mock-redeemed") card = { ...base, stamps: REQUIRED, rewards: 0 };
  else if (token === "mock-invalidated")
    card = { ...base, stamps: 3, rewards: 0, status: "INVALIDATED" };
  else if (token === "mock-pending") card = { ...base, stamps: 0, rewards: 0, status: "PENDING" };
  if (card) state.cards.set(token, card);
  return card;
}

const progressOf = (card: CardState) => ({
  current: card.stamps % REQUIRED,
  required: REQUIRED,
  remaining: REQUIRED - (card.stamps % REQUIRED),
  completedCards: Math.floor(card.stamps / REQUIRED),
  rewardsAvailable: card.rewards,
});

const rejected = (reason: RejectionReason, extra: Partial<ScanResult> = {}): ScanResult => ({
  outcome: "REJECTED",
  reason,
  message: REJECTION_MESSAGES[reason],
  replayed: false,
  ...extra,
});

function checkBranch(email: MockEmail, branchId: unknown): boolean {
  const scope = MOCK_ACCOUNTS[email].branchScope;
  const ids = MOCK_BRANCHES.map((b) => b.id);
  if (branchId === undefined)
    return scope === "ALL" || (Array.isArray(scope) && scope.length === 1);
  if (typeof branchId !== "string" || !ids.includes(branchId)) return false;
  return scope === "ALL" || (Array.isArray(scope) && scope.includes(branchId));
}

function evaluate(
  state: MockState,
  email: MockEmail,
  body: Record<string, unknown>,
): ScanResult | { card: CardState } {
  if (!checkBranch(email, body.branchId)) return rejected("BRANCH_NOT_PERMITTED");
  const card = cardFor(state, body.cardToken);
  if (!card) return rejected("INVALID_TOKEN");
  const who = { customer: { firstName: card.firstName }, progress: progressOf(card) };
  if (card.status !== "ACTIVE") return rejected("MEMBERSHIP_INACTIVE");
  if (card.cooldown) return rejected("COOLDOWN_ACTIVE", { retryAfterSeconds: 120, ...who });
  return { card };
}

function replayOr(
  ctx: MockContext,
  operation: string,
  fingerprint: string,
  create: () => MockReply,
): MockReply {
  const key = `${operation}:${ctx.idempotencyKey}`;
  if (!ctx.idempotencyKey) {
    return error(400, "VALIDATION_FAILED", "Request validation failed.", [
      "Idempotency-Key header is required",
    ]);
  }
  const stored = ctx.state.idempotency.get(key);
  if (stored) {
    if (stored.fingerprint !== fingerprint) {
      return error(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        "This key was already used for a different request.",
      );
    }
    return { status: 200, body: { ...(stored.reply.body as object), replayed: true } };
  }
  const reply = create();
  ctx.state.idempotency.set(key, { fingerprint, reply });
  return reply;
}

const asRecord = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

const PHONE = /^(?:\+?251|0)?9\d{8}$/;

export function createHandlers(): MockRoute[] {
  return [
    // ───────── Authentication ─────────
    {
      method: "POST",
      path: "/auth/login",
      handle: (ctx) => {
        const { email, password } = asRecord(ctx.body);
        const problems: string[] = [];
        if (typeof email !== "string" || !email) problems.push("email must be an email");
        if (typeof password !== "string" || !password)
          problems.push("password should not be empty");
        if (problems.length)
          return error(400, "VALIDATION_FAILED", "Request validation failed.", problems);
        const normalized = String(email).trim().toLowerCase();
        if (normalized === "busy@mock.test") {
          return error(429, "RATE_LIMITED", "Too many attempts.", undefined, {
            "retry-after": "30",
          });
        }
        if (!isMockEmail(normalized) || password !== MOCK_PASSWORD) {
          return error(401, "INVALID_CREDENTIALS", "Invalid email or password.");
        }
        const counter = (ctx.state.refreshCounter.get(normalized) ?? 0) + 1;
        ctx.state.refreshCounter.set(normalized, counter);
        ctx.state.refreshTokens.set(refreshTokenFor(normalized, counter), normalized);
        return ok(sessionFor(normalized, counter));
      },
    },
    {
      method: "POST",
      path: "/auth/refresh",
      handle: (ctx) => {
        const token = asRecord(ctx.body).refreshToken;
        const parsed = typeof token === "string" ? /^mock-refresh\.(.+)\.(\d+)$/.exec(token) : null;
        const owner = parsed && isMockEmail(parsed[1]) ? parsed[1] : undefined;
        const revoked = typeof token === "string" && ctx.state.revokedRefresh.has(token);
        // A token this process issued is valid. A well-formed token issued by ANOTHER process is accepted too:
        // the development server may answer requests from several workers that do not share memory, and a
        // mock must not log people out because of that. (The real backend's reuse detection is its own.)
        const email =
          typeof token === "string" && !revoked
            ? (ctx.state.refreshTokens.get(token) ?? owner)
            : undefined;
        if (!email) {
          // Reuse of an already-used token ends the whole session family, as the backend does.
          if (revoked && owner) {
            for (const [t, e] of ctx.state.refreshTokens) {
              if (e === owner) {
                ctx.state.refreshTokens.delete(t);
                ctx.state.revokedRefresh.add(t);
              }
            }
          }
          return error(401, "UNAUTHENTICATED", "Invalid refresh token.");
        }
        ctx.state.refreshTokens.delete(token as string);
        ctx.state.revokedRefresh.add(token as string);
        const counter =
          Math.max(ctx.state.refreshCounter.get(email) ?? 0, Number(parsed?.[2] ?? 0)) + 1;
        ctx.state.refreshCounter.set(email, counter);
        ctx.state.refreshTokens.set(refreshTokenFor(email, counter), email);
        return ok(sessionFor(email, counter));
      },
    },
    { method: "POST", path: "/auth/logout", handle: () => noContent() },
    {
      method: "POST",
      path: "/auth/logout-all",
      handle: (ctx) => {
        const auth = authenticate(ctx);
        if ("reply" in auth) return auth.reply;
        for (const [t, e] of ctx.state.refreshTokens) {
          if (e === auth.email) {
            ctx.state.refreshTokens.delete(t);
            ctx.state.revokedRefresh.add(t);
          }
        }
        return noContent();
      },
    },
    {
      method: "GET",
      path: "/auth/me",
      handle: (ctx) => {
        const auth = authenticate(ctx);
        return "reply" in auth ? auth.reply : ok(meFor(auth.email));
      },
    },

    // ───────── Public enrollment ─────────
    {
      method: "GET",
      path: "/join/{joinReference}",
      handle: (ctx) => {
        const unavailable = joinReferenceProblem(ctx.params.joinReference);
        return unavailable ?? ok(MOCK_JOIN_INFO);
      },
    },
    {
      method: "POST",
      path: "/join/{joinReference}/enroll",
      handle: (ctx) => {
        const unavailable = joinReferenceProblem(ctx.params.joinReference);
        if (unavailable) return unavailable;
        const body = asRecord(ctx.body);
        const problems: string[] = [];
        const first = typeof body.firstName === "string" ? body.firstName.trim() : "";
        if (!first) problems.push("firstName should not be empty");
        const digits = typeof body.phone === "string" ? body.phone.replace(/[\s-]/g, "") : "";
        if (!PHONE.test(digits)) problems.push("phone must be a valid Ethiopian mobile number");
        if (body.acceptTerms !== true) problems.push("acceptTerms must be true");
        if (body.preferredLanguage !== "EN" && body.preferredLanguage !== "AM") {
          problems.push("preferredLanguage must be one of the following values: EN, AM");
        }
        if (problems.length)
          return error(400, "VALIDATION_FAILED", "Request validation failed.", problems);
        if (body.consentVersion !== undefined && body.consentVersion !== MOCK_CONSENT_VERSION) {
          return error(
            409,
            "CONSENT_VERSION_STALE",
            "The terms have changed. Please review them again.",
          );
        }
        const customer = {
          firstName: first,
          preferredLanguage: body.preferredLanguage as "EN" | "AM",
        };
        const normalized = digits.replace(/^(?:\+?251|0)/, "");
        // Phone numbers ending 0000 behave as already enrolled (and any number enrolled twice does too).
        if (normalized.endsWith("0000") || ctx.state.enrolledPhones.has(normalized)) {
          return {
            status: 201,
            body: { ...MOCK_JOIN_INFO, status: "EXISTING", customer, card: null },
          };
        }
        ctx.state.enrolledPhones.add(normalized);
        const token = `mock-ok-${ctx.state.nextCard++}-${normalized.slice(-4)}`;
        ctx.state.cards.set(token, {
          stamps: 0,
          rewards: 0,
          status: "ACTIVE",
          cooldown: false,
          firstName: first,
        });
        return {
          status: 201,
          body: { ...MOCK_JOIN_INFO, status: "CREATED", customer, card: { token } },
        };
      },
    },

    // ───────── Customer card ─────────
    {
      method: "POST",
      path: "/card/web",
      handle: (ctx) => {
        const token = asRecord(ctx.body).cardToken;
        if (token === "mock-down") return error(503, "HTTP_503", "Service unavailable.");
        if (typeof token === "string" && token.startsWith("mock-flaky")) {
          const loads = (ctx.state.cardLoads.get(token) ?? 0) + 1;
          ctx.state.cardLoads.set(token, loads);
          if (loads > 2) return error(503, "HTTP_503", "Service unavailable.");
        }
        const card = cardFor(ctx.state, token);
        if (!card) return error(404, "NOT_FOUND", "Card not found.");
        return ok(
          webCardFor(token as string, {
            stamps: card.stamps,
            rewardsAvailable: card.rewards,
            status: card.status,
            firstName: card.firstName,
          }),
        );
      },
    },
    {
      method: "POST",
      path: "/card/wallet/links",
      handle: (ctx) => {
        const { cardToken, provider } = asRecord(ctx.body);
        if (!cardFor(ctx.state, cardToken)) return error(404, "NOT_FOUND", "Card not found.");
        if (provider === "WEB") return ok({ provider, kind: "NONE", url: null, expiresAt: null });
        if (provider === "APPLE" || provider === "GOOGLE") {
          // Wallets are "not configured" in the default backend setup; a token containing the provider enables it.
          if (!String(cardToken).includes(String(provider).toLowerCase())) {
            return error(409, "PROVIDER_NOT_AVAILABLE", "That wallet is not offered.");
          }
          return ok({
            provider,
            kind: provider === "APPLE" ? "DOWNLOAD" : "REDIRECT",
            url: `https://wallet.example.test/${String(provider).toLowerCase()}/pass`,
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          });
        }
        return error(400, "VALIDATION_FAILED", "Request validation failed.", [
          "provider must be one of the following values: APPLE, GOOGLE, WEB",
        ]);
      },
    },
    {
      method: "POST",
      path: "/card/consent/marketing/withdraw",
      handle: (ctx) =>
        cardFor(ctx.state, asRecord(ctx.body).cardToken)
          ? noContent()
          : error(404, "NOT_FOUND", "Card not found."),
    },

    // ───────── Loyalty programs (program:read to look, program:manage to change) ─────────
    {
      method: "GET",
      path: "/merchant/programs",
      handle: (ctx) => {
        const auth = authenticate(ctx, "program:read");
        return "reply" in auth ? auth.reply : ok(programsFor(ctx.state.programs, auth.email));
      },
    },
    {
      method: "POST",
      path: "/merchant/programs",
      handle: (ctx) => {
        const auth = authenticate(ctx, "program:manage");
        if ("reply" in auth) return auth.reply;
        return createProgram(ctx.state.programs, auth.email, ctx.body);
      },
    },
    {
      method: "PATCH",
      path: "/merchant/programs/{programId}",
      handle: (ctx) => {
        const auth = authenticate(ctx, "program:manage");
        if ("reply" in auth) return auth.reply;
        return updateProgram(ctx.state.programs, auth.email, ctx.params.programId!, ctx.body);
      },
    },
    ...(["activate", "pause", "archive"] as const).map((action): MockRoute => ({
      method: "POST",
      path: `/merchant/programs/{programId}/${action}`,
      handle: (ctx) => {
        const auth = authenticate(ctx, "program:manage");
        if ("reply" in auth) return auth.reply;
        return changeStatus(ctx.state.programs, auth.email, ctx.params.programId!, action);
      },
    })),

    // ───────── Analytics (analytics:read) and audit (audit:read) ─────────
    ...(
      [
        ["overview", overviewFor],
        ["branches", branchesFor],
        ["wallet", walletFor],
      ] as const
    ).map(([name, build]): MockRoute => ({
      method: "GET",
      path: `/merchant/analytics/${name}`,
      handle: (ctx) => {
        const auth = authenticate(ctx, "analytics:read");
        if ("reply" in auth) return auth.reply;
        const range = resolveMockRange(ctx.query);
        if (!range.ok) {
          return error(400, "VALIDATION_FAILED", "Request validation failed.", [range.message]);
        }
        return ok(build(range));
      },
    })),
    {
      method: "GET",
      path: "/merchant/analytics/staff",
      handle: (ctx) => {
        const auth = authenticate(ctx, "analytics:read");
        if ("reply" in auth) return auth.reply;
        const range = resolveMockRange(ctx.query);
        if (!range.ok) {
          return error(400, "VALIDATION_FAILED", "Request validation failed.", [range.message]);
        }
        return ok(staffFor(range, ctx.query));
      },
    },
    {
      method: "GET",
      path: "/merchant/analytics/cohorts",
      handle: (ctx) => {
        const auth = authenticate(ctx, "analytics:read");
        if ("reply" in auth) return auth.reply;
        const result = cohortsFor(ctx.query);
        return "error" in result
          ? error(400, "VALIDATION_FAILED", "Request validation failed.", [result.error])
          : ok(result);
      },
    },
    {
      method: "GET",
      path: "/merchant/analytics/monthly-returning-customers",
      handle: (ctx) => {
        const auth = authenticate(ctx, "analytics:read");
        if ("reply" in auth) return auth.reply;
        const result = monthlyReturningFor(ctx.query);
        return "error" in result
          ? error(400, "VALIDATION_FAILED", "Request validation failed.", [result.error])
          : ok(result);
      },
    },
    {
      method: "GET",
      path: "/merchant/analytics/definitions",
      handle: (ctx) => {
        const auth = authenticate(ctx, "analytics:read");
        return "reply" in auth ? auth.reply : ok(MOCK_DEFINITIONS);
      },
    },
    {
      method: "GET",
      path: "/merchant/audit",
      handle: (ctx) => {
        const auth = authenticate(ctx, "audit:read");
        if ("reply" in auth) return auth.reply;
        return fromReply(
          auditList(
            recordsFor(ctx.state.records, auth.email),
            ctx.query,
            MOCK_ACCOUNTS[auth.email].role === "OWNER",
          ),
        );
      },
    },

    {
      method: "POST",
      path: "/auth/invitations/accept",
      handle: (ctx) => acceptInvitation(ctx.state.orgs, ctx.body),
    },

    // ───────── Privacy and customer card tools (see privacy-data.ts) ─────────
    {
      method: "GET",
      path: "/merchant/customers/{customerId}/data",
      handle: (ctx) => {
        const auth = authenticate(ctx, "privacy:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return customerData(records, String(ctx.params.customerId));
      },
    },
    {
      method: "GET",
      path: "/merchant/customers/{customerId}/export",
      handle: (ctx) => {
        const auth = authenticate(ctx, "privacy:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return customerData(records, String(ctx.params.customerId));
      },
    },
    {
      method: "POST",
      path: "/merchant/customers/{customerId}/anonymize",
      handle: (ctx) => {
        const auth = authenticate(ctx, "privacy:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return anonymizeCustomer(records, String(ctx.params.customerId), ctx.body);
      },
    },
    {
      method: "POST",
      path: "/merchant/customers/{customerId}/consents/marketing/withdraw",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return withdrawConsent(records, auth.email, String(ctx.params.customerId));
      },
    },
    {
      method: "POST",
      path: "/merchant/memberships/{membershipId}/deactivate",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return setMembershipStatus(records, String(ctx.params.membershipId), false);
      },
    },
    {
      method: "POST",
      path: "/merchant/memberships/{membershipId}/reactivate",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return setMembershipStatus(records, String(ctx.params.membershipId), true);
      },
    },
    {
      method: "POST",
      path: "/merchant/memberships/{membershipId}/reissue-card",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return reissueCard(records, String(ctx.params.membershipId));
      },
    },
    {
      method: "POST",
      path: "/merchant/memberships/{membershipId}/wallet-passes/invalidate",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return invalidatePasses(records, String(ctx.params.membershipId));
      },
    },
    {
      method: "POST",
      path: "/merchant/wallet-passes/{passId}/resync",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return resyncPass(records, String(ctx.params.passId));
      },
    },
    {
      method: "GET",
      path: "/merchant/privacy/retention",
      handle: (ctx) => {
        const auth = authenticate(ctx, "privacy:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return getRetention(records);
      },
    },
    {
      method: "PUT",
      path: "/merchant/privacy/retention",
      handle: (ctx) => {
        const auth = authenticate(ctx, "privacy:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return setRetention(records, ctx.body);
      },
    },
    {
      method: "POST",
      path: "/merchant/privacy/retention/run",
      handle: (ctx) => {
        const auth = authenticate(ctx, "privacy:manage");
        if ("reply" in auth) return auth.reply;
        const records = recordsFor(ctx.state.records, auth.email);
        return runRetention(records);
      },
    },

    // ───────── Campaigns: PROPOSED operations, mock only (see campaigns-data.ts) ─────────
    {
      method: "GET",
      path: "/merchant/campaigns",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const data = campaignsFor(ctx.state.campaigns, auth.email);
        return listCampaigns(data, ctx.query);
      },
    },
    {
      method: "POST",
      path: "/merchant/campaigns",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const data = campaignsFor(ctx.state.campaigns, auth.email);
        return createCampaign(data, recordsFor(ctx.state.records, auth.email), ctx.body);
      },
    },
    {
      method: "POST",
      path: "/merchant/campaigns/{campaignId}/send",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const data = campaignsFor(ctx.state.campaigns, auth.email);
        return sendCampaign(data, String(ctx.params.campaignId), ctx.idempotencyKey);
      },
    },
    {
      method: "POST",
      path: "/merchant/campaigns/{campaignId}/cancel",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:manage");
        if ("reply" in auth) return auth.reply;
        const data = campaignsFor(ctx.state.campaigns, auth.email);
        return cancelCampaign(data, String(ctx.params.campaignId));
      },
    },

    // ───────── Fraud monitoring (see fraud-data.ts) ─────────
    {
      method: "GET",
      path: "/merchant/fraud/flags",
      handle: (ctx) => {
        const auth = authenticate(ctx, "fraud:read");
        return "reply" in auth
          ? auth.reply
          : listFlags(fraudFor(ctx.state.fraud, auth.email), ctx.query);
      },
    },
    {
      method: "POST",
      path: "/merchant/fraud/flags/{flagId}/review",
      handle: (ctx) => {
        const auth = authenticate(ctx, "fraud:manage");
        if ("reply" in auth) return auth.reply;
        return reviewFlag(
          fraudFor(ctx.state.fraud, auth.email),
          String(ctx.params.flagId),
          ctx.body,
        );
      },
    },
    {
      method: "GET",
      path: "/merchant/fraud/settings",
      handle: (ctx) => {
        const auth = authenticate(ctx, "fraud:read");
        return "reply" in auth ? auth.reply : ok(fraudFor(ctx.state.fraud, auth.email).thresholds);
      },
    },
    {
      method: "PUT",
      path: "/merchant/fraud/settings",
      handle: (ctx) => {
        const auth = authenticate(ctx, "fraud:manage");
        if ("reply" in auth) return auth.reply;
        return updateThresholds(fraudFor(ctx.state.fraud, auth.email), ctx.body);
      },
    },
    {
      method: "POST",
      path: "/merchant/fraud/evaluate",
      handle: (ctx) => {
        const auth = authenticate(ctx, "fraud:manage");
        return "reply" in auth ? auth.reply : evaluateFraud(fraudFor(ctx.state.fraud, auth.email));
      },
    },

    // ───────── Platform operations (platform administrators only) and health ─────────
    {
      method: "GET",
      path: "/platform/merchants",
      handle: (ctx) => {
        const auth = authenticate(ctx, "platform:manage");
        return "reply" in auth ? auth.reply : listMerchants(opsFor(ctx.state.ops, auth.email));
      },
    },
    {
      method: "GET",
      path: "/platform/outbox/stats",
      handle: (ctx) => {
        const auth = authenticate(ctx, "platform:manage");
        return "reply" in auth ? auth.reply : outboxStats(opsFor(ctx.state.ops, auth.email));
      },
    },
    {
      method: "GET",
      path: "/platform/outbox/dead",
      handle: (ctx) => {
        const auth = authenticate(ctx, "platform:manage");
        return "reply" in auth ? auth.reply : deadJobs(opsFor(ctx.state.ops, auth.email));
      },
    },
    {
      method: "POST",
      path: "/platform/outbox/dead/{jobId}/requeue",
      handle: (ctx) => {
        const auth = authenticate(ctx, "platform:manage");
        if ("reply" in auth) return auth.reply;
        return requeueDead(opsFor(ctx.state.ops, auth.email), String(ctx.params.jobId));
      },
    },
    {
      method: "GET",
      path: "/platform/audit",
      handle: (ctx) => {
        const auth = authenticate(ctx, "platform:audit:read");
        if ("reply" in auth) return auth.reply;
        return platformAudit(opsFor(ctx.state.ops, auth.email), ctx.query);
      },
    },
    {
      method: "GET",
      path: "/health",
      handle: () => ok({ status: "ok", timestamp: new Date().toISOString() }),
    },
    {
      method: "GET",
      path: "/health/ready",
      handle: () => ok({ status: "ok", info: { database: { status: "up" } } }),
    },

    // ───────── Customers, rewards and reversals (see records-data.ts) ─────────
    {
      method: "GET",
      path: "/merchant/customers",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:read");
        if ("reply" in auth) return auth.reply;
        const canManage = (MOCK_ACCOUNTS[auth.email].permissions as readonly string[]).includes(
          "customer:manage",
        );
        return fromReply(
          listCustomers(recordsFor(ctx.state.records, auth.email), ctx.query, canManage),
        );
      },
    },
    {
      method: "GET",
      path: "/merchant/memberships/{membershipId}/rewards",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:read");
        if ("reply" in auth) return auth.reply;
        return fromReply(
          membershipSummary(
            recordsFor(ctx.state.records, auth.email),
            String(ctx.params.membershipId),
          ),
        );
      },
    },
    {
      method: "GET",
      path: "/merchant/memberships/{membershipId}/ledger",
      handle: (ctx) => {
        const auth = authenticate(ctx, "reversal:create");
        if ("reply" in auth) return auth.reply;
        return fromReply(
          membershipLedger(
            recordsFor(ctx.state.records, auth.email),
            String(ctx.params.membershipId),
          ),
        );
      },
    },
    {
      method: "GET",
      path: "/merchant/memberships/{membershipId}/wallet-passes",
      handle: (ctx) => {
        const auth = authenticate(ctx, "customer:read");
        if ("reply" in auth) return auth.reply;
        return fromReply(
          membershipPasses(
            recordsFor(ctx.state.records, auth.email),
            String(ctx.params.membershipId),
          ),
        );
      },
    },
    {
      method: "POST",
      path: "/merchant/stamps/{stampId}/reverse",
      handle: (ctx) => {
        const auth = authenticate(ctx, "reversal:create");
        if ("reply" in auth) return auth.reply;
        return fromReply(
          reverse(
            recordsFor(ctx.state.records, auth.email),
            auth.email,
            "STAMP",
            String(ctx.params.stampId),
            ctx.body,
            ctx.idempotencyKey,
          ),
        );
      },
    },
    {
      method: "POST",
      path: "/merchant/redemptions/{redemptionId}/reverse",
      handle: (ctx) => {
        const auth = authenticate(ctx, "reversal:create");
        if ("reply" in auth) return auth.reply;
        return fromReply(
          reverse(
            recordsFor(ctx.state.records, auth.email),
            auth.email,
            "REDEMPTION",
            String(ctx.params.redemptionId),
            ctx.body,
            ctx.idempotencyKey,
          ),
        );
      },
    },

    // ───────── Branches ─────────
    {
      method: "GET",
      path: "/merchant/branches",
      handle: (ctx) => {
        const auth = authenticate(ctx, "branch:read");
        if ("reply" in auth) return auth.reply;
        return ok(visibleBranches(auth.email, orgFor(ctx.state.orgs, auth.email)));
      },
    },
    {
      method: "POST",
      path: "/merchant/branches",
      handle: (ctx) => {
        const auth = authenticate(ctx, "branch:manage");
        if ("reply" in auth) return auth.reply;
        return createBranch(orgFor(ctx.state.orgs, auth.email), ctx.body);
      },
    },
    {
      method: "PATCH",
      path: "/merchant/branches/{branchId}",
      handle: (ctx) => {
        const auth = authenticate(ctx, "branch:manage");
        if ("reply" in auth) return auth.reply;
        return updateBranch(orgFor(ctx.state.orgs, auth.email), ctx.params.branchId!, ctx.body);
      },
    },
    ...(
      [
        ["activate", "ACTIVE"],
        ["deactivate", "INACTIVE"],
      ] as const
    ).map(([action, status]): MockRoute => ({
      method: "POST",
      path: `/merchant/branches/{branchId}/${action}`,
      handle: (ctx) => {
        const auth = authenticate(ctx, "branch:manage");
        if ("reply" in auth) return auth.reply;
        return setBranchStatus(orgFor(ctx.state.orgs, auth.email), ctx.params.branchId!, status);
      },
    })),

    // ───────── Team (staff:read to look, staff:manage to change) ─────────
    {
      method: "GET",
      path: "/merchant/staff",
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:read");
        return "reply" in auth ? auth.reply : ok(orgFor(ctx.state.orgs, auth.email).staff);
      },
    },
    {
      method: "POST",
      path: "/merchant/staff",
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:manage");
        if ("reply" in auth) return auth.reply;
        return inviteStaff(orgFor(ctx.state.orgs, auth.email), auth.email, ctx.body);
      },
    },
    {
      method: "GET",
      path: "/merchant/staff/{staffId}/activity",
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:read");
        if ("reply" in auth) return auth.reply;
        return staffActivity(orgFor(ctx.state.orgs, auth.email), ctx.params.staffId!, ctx.query);
      },
    },
    {
      method: "POST",
      path: "/merchant/staff/{staffId}/invitation",
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:manage");
        if ("reply" in auth) return auth.reply;
        return reissueInvitation(
          orgFor(ctx.state.orgs, auth.email),
          auth.email,
          ctx.params.staffId!,
        );
      },
    },
    {
      method: "PATCH",
      path: "/merchant/staff/{staffId}/role",
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:manage");
        if ("reply" in auth) return auth.reply;
        return changeRole(
          orgFor(ctx.state.orgs, auth.email),
          auth.email,
          ctx.params.staffId!,
          ctx.body,
        );
      },
    },
    {
      method: "PUT",
      path: "/merchant/staff/{staffId}/branches",
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:manage");
        if ("reply" in auth) return auth.reply;
        return setStaffBranches(
          orgFor(ctx.state.orgs, auth.email),
          auth.email,
          ctx.params.staffId!,
          ctx.body,
        );
      },
    },
    ...(
      [
        ["activate", "ACTIVE"],
        ["deactivate", "DEACTIVATED"],
      ] as const
    ).map(([action, to]): MockRoute => ({
      method: "POST",
      path: `/merchant/staff/{staffId}/${action}`,
      handle: (ctx) => {
        const auth = authenticate(ctx, "staff:manage");
        if ("reply" in auth) return auth.reply;
        return setStaffStatus(
          orgFor(ctx.state.orgs, auth.email),
          auth.email,
          ctx.params.staffId!,
          to,
        );
      },
    })),

    {
      method: "GET",
      path: "/merchant/profile",
      handle: (ctx) => {
        const auth = authenticate(ctx, "merchant:read");
        if ("reply" in auth) return auth.reply;
        return ok(profileFor(ctx.state.profiles, auth.email));
      },
    },
    {
      method: "PATCH",
      path: "/merchant/profile",
      handle: (ctx) => {
        const auth = authenticate(ctx, "merchant:update");
        if ("reply" in auth) return auth.reply;
        return updateProfile(profileFor(ctx.state.profiles, auth.email), ctx.body);
      },
    },

    // ───────── Scanner ─────────
    {
      method: "POST",
      path: "/scanner/validate",
      handle: (ctx) => {
        const auth = authenticate(ctx, "stamp:create");
        if ("reply" in auth) return auth.reply;
        const result = evaluate(ctx.state, auth.email, asRecord(ctx.body));
        if (!("card" in result)) return ok(result);
        const card = result.card;
        return ok({
          outcome: "ELIGIBLE",
          reason: null,
          message: { en: "Ready to stamp.", am: "ለማተም ዝግጁ ነው።" },
          customer: { firstName: card.firstName },
          progress: progressOf(card),
          wouldUnlockReward: card.stamps % REQUIRED === REQUIRED - 1,
          replayed: false,
        } satisfies ScanResult);
      },
    },
    {
      method: "POST",
      path: "/scanner/stamps",
      handle: (ctx) => {
        const auth = authenticate(ctx, "stamp:create");
        if ("reply" in auth) return auth.reply;
        const body = asRecord(ctx.body);
        return replayOr(ctx, "stamp", `${body.cardToken}|${body.branchId}`, () => {
          const result = evaluate(ctx.state, auth.email, body);
          if (!("card" in result)) return ok(result);
          const card = result.card;
          card.stamps += 1;
          const unlocked = card.stamps % REQUIRED === 0;
          if (unlocked) card.rewards += 1;
          return ok({
            outcome: "STAMPED",
            reason: null,
            message: { en: "Stamp added.", am: "ስታምፕ ተጨምሯል።" },
            customer: { firstName: card.firstName },
            stamp: { id: `stamp-${card.stamps}`, occurredAt: new Date().toISOString() },
            progress: progressOf(card),
            reward: unlocked
              ? {
                  unlocked: true,
                  unlockId: `unlock-${card.stamps}`,
                  nameEn: "Free coffee",
                  nameAm: "ነጻ ቡና",
                  expiresAt: null,
                }
              : { unlocked: false },
            replayed: false,
          } satisfies ScanResult);
        });
      },
    },
    {
      method: "POST",
      path: "/scanner/rewards/lookup",
      handle: (ctx) => {
        const auth = authenticate(ctx, "redemption:create");
        if ("reply" in auth) return auth.reply;
        return ok(lookup(ctx.state, auth.email, asRecord(ctx.body)));
      },
    },
    {
      method: "POST",
      path: "/scanner/redemptions",
      handle: (ctx) => {
        const auth = authenticate(ctx, "redemption:create");
        if ("reply" in auth) return auth.reply;
        const body = asRecord(ctx.body);
        return replayOr(
          ctx,
          "redeem",
          `${body.cardToken}|${body.branchId}|${body.rewardUnlockId}`,
          () => {
            const result = lookup(ctx.state, auth.email, body);
            if (result.outcome !== "AVAILABLE" || !result.rewards?.length) return ok(result);
            const card = cardFor(ctx.state, body.cardToken)!;
            const reward =
              result.rewards.find((r) => r.unlockId === body.rewardUnlockId) ??
              (body.rewardUnlockId ? undefined : result.rewards[0]);
            if (!reward) {
              return ok({
                outcome: "REJECTED",
                reason: "REWARD_NOT_AVAILABLE",
                message: REJECTION_MESSAGES.REWARD_NOT_AVAILABLE,
                replayed: false,
              } satisfies RedeemResult);
            }
            card.rewards -= 1;
            return ok({
              outcome: "REDEEMED",
              reason: null,
              message: { en: "Reward redeemed.", am: "ሽልማቱ ተሰጥቷል።" },
              customer: { firstName: card.firstName },
              reward,
              redemption: { id: `redemption-${Date.now()}`, occurredAt: new Date().toISOString() },
              progress: progressOf(card),
              replayed: false,
            } satisfies RedeemResult);
          },
        );
      },
    },
  ];
}

function lookup(state: MockState, email: MockEmail, body: Record<string, unknown>): RedeemResult {
  const result = evaluate(state, email, body);
  if (!("card" in result)) {
    // A cooldown does not matter for handing over a reward.
    if (result.reason !== "COOLDOWN_ACTIVE")
      return {
        outcome: "REJECTED",
        reason: result.reason,
        message: result.message,
        replayed: false,
      };
  }
  const card = "card" in result ? result.card : cardFor(state, body.cardToken);
  if (!card || card.rewards < 1) {
    return {
      outcome: "REJECTED",
      reason: "NO_REWARD_AVAILABLE",
      message: REJECTION_MESSAGES.NO_REWARD_AVAILABLE,
      replayed: false,
    };
  }
  return {
    outcome: "AVAILABLE",
    reason: null,
    message: { en: "A reward is ready.", am: "ሽልማት ዝግጁ ነው።" },
    customer: { firstName: card.firstName },
    rewards: Array.from({ length: card.rewards }, (_, i) => ({
      unlockId: `unlock-${i + 1}`,
      nameEn: "Free coffee",
      nameAm: "ነጻ ቡና",
      descriptionEn: "Any coffee from the menu.",
      descriptionAm: "ከዝርዝሩ ማንኛውም ቡና።",
      unlockedAt: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: null,
    })),
    progress: progressOf(card),
    replayed: false,
  };
}

/** "sample-cafe" works; "busy" is rate limited; "down" is unavailable; anything else is simply not joinable. */
function joinReferenceProblem(reference: string | undefined): MockReply | undefined {
  if (reference === "sample-cafe") return undefined;
  if (reference === "busy")
    return error(429, "RATE_LIMITED", "Too many requests.", undefined, { "retry-after": "20" });
  if (reference === "down") return error(503, "HTTP_503", "Service unavailable.");
  return error(404, "NOT_FOUND", "This join link is not available.");
}

export { accessTokenFor };
