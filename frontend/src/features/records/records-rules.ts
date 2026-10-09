import { ACTION_LABEL } from "@/features/org/action-labels";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

/** The word typed to unlock the final "Reverse now" button. */
export const REVERSE_PHRASE = "REVERSE";
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Audit actions with their translated names. Unknown codes are shown as "Other activity (code)". */
export const AUDIT_ACTION_LABEL: Record<string, MessageKey> = {
  ...ACTION_LABEL,
  "stamp.reversed": "records.actionStampReversed",
  "redemption.reversed": "records.actionRedemptionReversed",
  "staff.invited": "records.actionStaffInvited",
  "program.updated": "records.actionProgramUpdated",
  "customer.enrolled": "records.actionCustomerEnrolled",
  "membership.card_reissued": "records.actionCardReissued",
};

/** Actions offered in the audit filter, in a sensible reading order. */
export const FILTERABLE_ACTIONS = [
  "stamp.issued",
  "reward.unlocked",
  "reward.redeemed",
  "stamp.reversed",
  "redemption.reversed",
  "scan.rejected",
  "customer.enrolled",
  "membership.card_reissued",
  "program.activated",
  "program.updated",
  "branch.updated",
  "staff.invited",
  "staff.role_changed",
  "auth.login",
] as const;

export const TARGET_LABEL: Record<string, MessageKey> = {
  membership: "records.targetMembership",
  branch: "records.targetBranch",
  program: "records.targetProgram",
  staff_membership: "records.targetStaff",
  customer: "records.targetCustomer",
};

export function reasonProblem(reason: string): "short" | "long" | null {
  const length = reason.trim().length;
  if (length < REASON_MIN) return "short";
  if (length > REASON_MAX) return "long";
  return null;
}

/**
 * Keys whose values must never reach the screen, even if a bug or a future backend change put them in the metadata.
 * The backend already cleans metadata; this is the second, independent barrier.
 */
const SENSITIVE_KEY =
  /pass(word|code|phrase)?$|secret|token|credential|authorization|cookie|session|api[-_]?key|private|signature|hash|^key$|otp|pin$|cvv|^ip$|ipaddress|useragent|user-agent|device/i;

export interface SafeMetadataRow {
  key: string;
  label: string;
  value: string;
}

function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function printable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map(printable).filter((v): v is string => v !== null);
    return items.length ? items.join(", ") : null;
  }
  return null; // nested objects are not shown: they are where secrets hide
}

/** Flat, labelled, safe rows for the expandable details of an audit entry. */
export function safeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): SafeMetadataRow[] {
  if (!metadata) return [];
  const rows: SafeMetadataRow[] = [];
  for (const [key, raw] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const value = printable(raw);
    if (value === null || value === "") continue;
    rows.push({ key, label: humanize(key), value });
  }
  return rows;
}

/** A phone number as a person without full access may see it, even if the backend were to send more. */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return "*".repeat(phone.length);
  return `${phone.slice(0, 5)}${"*".repeat(phone.length - 8)}${phone.slice(-3)}`;
}

export function displayPhone(
  customer: { phone: string | null; phoneMasked: boolean },
  canManage: boolean,
): string | null {
  if (!customer.phone) return null;
  if (customer.phoneMasked) return customer.phone;
  // Not flagged as masked: only people who may manage customers get the full number.
  return canManage ? customer.phone : maskPhone(customer.phone);
}

/** `from`/`to` are calendar days (YYYY-MM-DD); the range is valid when the start is not after the end. */
export function rangeProblem(from: string, to: string): boolean {
  return Boolean(from && to && from > to);
}

/** What a refused reversal means, in words. The backend's English text is never shown. */
export function explainReversalError(error: unknown, t: Translate): string {
  const e = toApiError(error);
  if (e.code === "ALREADY_REVERSED") return t("records.errAlreadyReversed");
  if (e.code === "REWARD_ALREADY_REDEEMED") return t("records.errRewardRedeemed");
  if (e.kind === "forbidden") return t("records.errReverseForbidden");
  if (e.kind === "not_found") return t("records.errNotFound");
  if (e.kind === "validation") return t("records.errReasonInvalid");
  return describeApiError(e, t).description;
}
