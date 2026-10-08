import type { RedeemResult, RejectionReason, ScanResult } from "@/lib/api/contract";
import { isApiError } from "@/lib/errors/api-error";
import type { MessageKey } from "@/lib/i18n/translator";

/**
 * The scanner's state machine, kept free of React and the network so every transition can be tested.
 *
 *   ready ─ code read ─▶ checking ─▶ confirm ─ add stamp ─▶ stamping ─▶ done
 *                           │            └─ redeem reward ─▶ redeeming ─▶ done
 *                           └─▶ done (rejected) / problem
 *
 * Nothing here decides whether a stamp or reward is allowed: that is always the backend's answer. The browser
 * only shows what it is told, and a success screen exists only after the backend has confirmed the action.
 */

export interface RecentEntry {
  id: number;
  kind: "stamp" | "redeem" | "rejected";
  /** First name only; never a phone number or card code. */
  name: string;
  at: number;
}

export type ProblemKind = "offline" | "unavailable" | "permission" | "rate" | "unexpected";

/** What the staff member was doing when the problem happened, so "check again" repeats exactly that. */
export type Pending =
  | { action: "check"; token: string }
  | { action: "stamp"; token: string; key: string; name: string }
  | { action: "redeem"; token: string; key: string; name: string; unlockId?: string };

export type Phase =
  | { name: "ready" }
  | { name: "checking"; token: string }
  | {
      name: "confirm";
      token: string;
      /** Result of the read-only eligibility check (can this card be stamped now?). */
      check: ScanResult;
      /** Rewards that can be handed over right now, if any. */
      rewards: RedeemResult | null;
    }
  | { name: "stamping"; token: string; key: string; customerName: string }
  | { name: "redeeming"; token: string; key: string; customerName: string; unlockId?: string }
  | { name: "done"; outcome: DoneOutcome }
  | {
      name: "problem";
      kind: ProblemKind;
      pending: Pending;
      retryAfterSeconds?: number;
      /** True when the request may have reached the backend, so the result is unknown (never assume). */
      uncertain: boolean;
    };

export type DoneOutcome =
  | { kind: "stamped"; result: ScanResult; name: string }
  | { kind: "redeemed"; result: RedeemResult; name: string }
  | {
      kind: "rejected";
      reason: RejectionReason | null;
      message: { en: string; am: string };
      retryAfterSeconds?: number;
      name: string | null;
    }
  | { kind: "notCard" };

export interface ScannerState {
  phase: Phase;
  recent: RecentEntry[];
  nextId: number;
}

export const initialScannerState: ScannerState = {
  phase: { name: "ready" },
  recent: [],
  nextId: 1,
};

export const RECENT_LIMIT = 8;

export type ScannerAction =
  | { type: "codeRead"; token: string }
  | { type: "notACard" }
  | { type: "checked"; token: string; check: ScanResult; rewards: RedeemResult | null; now: number }
  | { type: "stampStarted"; token: string; key: string; name: string }
  | { type: "stamped"; result: ScanResult; name: string; now: number }
  | { type: "redeemStarted"; token: string; key: string; name: string; unlockId?: string }
  | { type: "redeemed"; result: RedeemResult; name: string; now: number }
  | { type: "rejected"; result: ScanResult | RedeemResult; name: string | null; now: number }
  | {
      type: "failed";
      pending: Pending;
      kind: ProblemKind;
      uncertain: boolean;
      retryAfterSeconds?: number;
    }
  | { type: "dismiss" };

const withRecent = (
  state: ScannerState,
  kind: RecentEntry["kind"],
  name: string,
  now: number,
): Pick<ScannerState, "recent" | "nextId"> => ({
  recent: [{ id: state.nextId, kind, name, at: now }, ...state.recent].slice(0, RECENT_LIMIT),
  nextId: state.nextId + 1,
});

/** Rejections that leave a reward still reachable: the card is fine, only stamping is blocked right now. */
const STAMP_ONLY_BLOCKS: ReadonlySet<RejectionReason> = new Set([
  "COOLDOWN_ACTIVE",
  "MEMBERSHIP_INACTIVE",
  "PROGRAM_INACTIVE",
]);

export function scannerReducer(state: ScannerState, action: ScannerAction): ScannerState {
  switch (action.type) {
    case "codeRead":
      // Only from the ready screen: a second code while one is being handled is ignored.
      return state.phase.name === "ready"
        ? { ...state, phase: { name: "checking", token: action.token } }
        : state;

    case "notACard":
      return state.phase.name === "ready"
        ? { ...state, phase: { name: "done", outcome: { kind: "notCard" } } }
        : state;

    case "checked": {
      if (state.phase.name !== "checking" || state.phase.token !== action.token) return state;
      const { check, rewards } = action;
      const hasRewards = rewards?.outcome === "AVAILABLE" && (rewards.rewards?.length ?? 0) > 0;
      const canStamp = check.outcome === "ELIGIBLE";
      if (canStamp || hasRewards) {
        return {
          ...state,
          phase: {
            name: "confirm",
            token: action.token,
            check,
            rewards: hasRewards ? rewards : null,
          },
        };
      }
      const name = check.customer?.firstName ?? null;
      return {
        ...state,
        ...withRecent(state, "rejected", name ?? "", action.now),
        phase: {
          name: "done",
          outcome: {
            kind: "rejected",
            reason: check.reason,
            message: check.message,
            retryAfterSeconds: check.retryAfterSeconds,
            name,
          },
        },
      };
    }

    case "stampStarted":
      return state.phase.name === "confirm" || state.phase.name === "problem"
        ? {
            ...state,
            phase: {
              name: "stamping",
              token: action.token,
              key: action.key,
              customerName: action.name,
            },
          }
        : state;

    case "stamped":
      return state.phase.name === "stamping"
        ? {
            ...state,
            ...withRecent(state, "stamp", action.name, action.now),
            phase: {
              name: "done",
              outcome: { kind: "stamped", result: action.result, name: action.name },
            },
          }
        : state;

    case "redeemStarted":
      return state.phase.name === "confirm" || state.phase.name === "problem"
        ? {
            ...state,
            phase: {
              name: "redeeming",
              token: action.token,
              key: action.key,
              customerName: action.name,
              unlockId: action.unlockId,
            },
          }
        : state;

    case "redeemed":
      return state.phase.name === "redeeming"
        ? {
            ...state,
            ...withRecent(state, "redeem", action.name, action.now),
            phase: {
              name: "done",
              outcome: { kind: "redeemed", result: action.result, name: action.name },
            },
          }
        : state;

    case "rejected": {
      if (state.phase.name !== "stamping" && state.phase.name !== "redeeming") return state;
      const { result } = action;
      return {
        ...state,
        ...withRecent(state, "rejected", action.name ?? "", action.now),
        phase: {
          name: "done",
          outcome: {
            kind: "rejected",
            reason: result.reason,
            message: result.message,
            retryAfterSeconds: "retryAfterSeconds" in result ? result.retryAfterSeconds : undefined,
            name: action.name,
          },
        },
      };
    }

    case "failed":
      return {
        ...state,
        phase: {
          name: "problem",
          kind: action.kind,
          pending: action.pending,
          uncertain: action.uncertain,
          retryAfterSeconds: action.retryAfterSeconds,
        },
      };

    case "dismiss":
      return { ...state, phase: { name: "ready" } };
  }
}

/** Whether a stamp can be attempted from this check result (the backend said ELIGIBLE). */
export const canStamp = (check: ScanResult) => check.outcome === "ELIGIBLE";

/** A rejection that only blocks stamping, shown beside a reward that can still be given. */
export const isStampOnlyBlock = (check: ScanResult) =>
  check.outcome === "REJECTED" && check.reason !== null && STAMP_ONLY_BLOCKS.has(check.reason);

export interface RejectionView {
  title: MessageKey;
  body?: MessageKey;
  /** "warning" for things that fix themselves or need a different action, "danger" for a refusal. */
  tone: "danger" | "warning";
}

/**
 * Our own wording per reason, so the headline is always translated and consistent. The backend's bilingual
 * `message` is shown beneath it as the detail. "Wrong business" cannot be told apart from "unknown card" by
 * design (the backend answers both INVALID_TOKEN), so one message covers both.
 */
export function rejectionView(reason: RejectionReason | null): RejectionView {
  switch (reason) {
    case "INVALID_TOKEN":
      return { title: "scanner.invalidTitle", body: "scanner.invalidBody", tone: "danger" };
    case "BRANCH_NOT_PERMITTED":
      return { title: "scanner.branchTitle", body: "scanner.permissionBody", tone: "danger" };
    case "MEMBERSHIP_INACTIVE":
      return { title: "scanner.inactiveTitle", tone: "danger" };
    case "PROGRAM_INACTIVE":
      return { title: "scanner.programInactiveTitle", tone: "danger" };
    case "COOLDOWN_ACTIVE":
      return { title: "scanner.cooldownTitle", tone: "warning" };
    case "NO_REWARD_AVAILABLE":
      return { title: "scanner.noRewardTitle", tone: "warning" };
    case "REWARD_NOT_AVAILABLE":
      return { title: "scanner.rewardGoneTitle", tone: "warning" };
    default:
      return { title: "scanner.rejectedTitle", tone: "danger" };
  }
}

/**
 * What a failed request means for the person at the counter.
 *  - `uncertain`: the request may have reached the backend (network lost, timeout, server error), so whether the
 *    stamp or reward was recorded is unknown and must be checked, never assumed.
 *  - otherwise the backend refused before doing anything (not signed in, not allowed, too many requests).
 */
export function classifyFailure(
  error: unknown,
  online: boolean,
): { kind: ProblemKind; uncertain: boolean; retryAfterSeconds?: number } {
  if (!isApiError(error)) return { kind: "unexpected", uncertain: true };
  switch (error.kind) {
    case "forbidden":
      return { kind: "permission", uncertain: false };
    case "rate_limited":
      return { kind: "rate", uncertain: false, retryAfterSeconds: error.retryAfterSeconds };
    case "network":
      return { kind: online ? "unavailable" : "offline", uncertain: true };
    case "timeout":
    case "unavailable":
    case "server":
      return { kind: "unavailable", uncertain: true };
    default:
      return { kind: "unexpected", uncertain: true };
  }
}

/** Minutes to show for a cooldown, rounded up so the wait is never understated. */
export const cooldownMinutes = (seconds: number | undefined): number =>
  Math.max(1, Math.ceil((seconds ?? 60) / 60));
