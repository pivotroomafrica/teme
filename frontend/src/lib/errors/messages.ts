import type { Translate } from "@/lib/i18n/translator";
import type { ApiError } from "./api-error";

/**
 * Turns an ApiError into text for the active language. The backend's own `message` is English only and may
 * contain technical wording, so it is never shown to people; it stays in logs and the support reference.
 */
export function describeApiError(
  error: ApiError,
  t: Translate,
): { title: string; description: string } {
  const title = t("errors.genericTitle");
  switch (error.kind) {
    case "network":
      return { title, description: t("errors.network") };
    case "timeout":
      return { title, description: t("errors.timeout") };
    case "unauthenticated":
      return { title: t("errors.forbiddenTitle"), description: t("errors.unauthenticated") };
    case "forbidden":
      return { title: t("errors.forbiddenTitle"), description: t("errors.forbiddenAction") };
    case "rate_limited":
      return {
        title,
        description:
          error.retryAfterSeconds !== undefined
            ? t("errors.rateLimitedSeconds", { seconds: error.retryAfterSeconds })
            : t("errors.rateLimited"),
      };
    case "unavailable":
      return { title, description: t("errors.unavailable") };
    case "server":
      return { title, description: t("errors.server") };
    case "validation":
      return { title, description: t("errors.validation") };
    case "conflict":
      return { title, description: t("errors.conflict") };
    case "not_found":
      return { title: t("errors.notFoundTitle"), description: t("errors.notFoundResource") };
    case "unprocessable":
      return { title, description: t("errors.unprocessable") };
    case "payload_too_large":
      return { title, description: t("errors.payloadTooLarge") };
    case "malformed":
      return { title, description: t("errors.malformed") };
    default:
      return { title, description: t("errors.unexpected") };
  }
}
