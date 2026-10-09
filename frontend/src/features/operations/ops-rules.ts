import type { PlatformMerchant } from "@/lib/api/contract";
import type { Tone } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/translator";

export const MERCHANT_STATUS_LABEL: Record<PlatformMerchant["status"], MessageKey> = {
  ACTIVE: "ops.statusActive",
  SUSPENDED: "ops.statusSuspended",
  DEACTIVATED: "ops.statusDeactivated",
};
export const MERCHANT_STATUS_TONE: Record<PlatformMerchant["status"], Tone> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  DEACTIVATED: "neutral",
};

export const JOB_TYPE_LABEL: Record<string, MessageKey> = {
  "wallet.pass_update": "ops.jobWalletUpdate",
  "fraud.evaluate": "ops.jobFraudEvaluate",
};

/** Job-count statuses in a fixed reading order, with their words. Unknown statuses are not shown as a tile. */
export const JOB_STATUS_LABEL: Record<string, MessageKey> = {
  PENDING: "ops.jobPending",
  PROCESSING: "ops.jobProcessing",
  FAILED: "ops.jobFailed",
  DEAD: "ops.jobDead",
  COMPLETED: "ops.jobCompleted",
};
export const JOB_STATUS_ORDER = ["PENDING", "PROCESSING", "FAILED", "DEAD", "COMPLETED"] as const;

/** Search by name (either language) or short name; optional status filter. Pure filtering of what the backend sent. */
export function filterMerchants(
  merchants: readonly PlatformMerchant[],
  filter: { search: string; status: string },
): PlatformMerchant[] {
  const q = filter.search.trim().toLowerCase();
  return merchants.filter(
    (m) =>
      (!filter.status || m.status === filter.status) &&
      (!q ||
        m.nameEn.toLowerCase().includes(q) ||
        (m.nameAm ?? "").toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q)),
  );
}

const MAX_ERROR_CHARS = 280;

/**
 * Makes a job's error text safe to show. The backend already scrubs credentials; this is the second, independent
 * barrier: values after secret-looking names, bearer tokens, JWT-shaped strings and long opaque strings are replaced,
 * and the text is shortened.
 */
export function redactError(text: string | null | undefined): string {
  if (!text) return "";
  const cleaned = text
    // name=value, name: value, "name":"value" for secret-looking names
    .replace(
      /\b([\w-]*(?:token|secret|password|passwd|pwd|credential|authorization|api[-_]?key|private[-_]?key|signature|cookie|session)[\w-]*)(["']?\s*[:=]\s*)(?:Bearer\s+)?["']?[^\s"',;]+/gi,
      "$1$2[hidden]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [hidden]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[hidden]")
    .replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, "[hidden]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return cleaned.length > MAX_ERROR_CHARS ? `${cleaned.slice(0, MAX_ERROR_CHARS)}…` : cleaned;
}
