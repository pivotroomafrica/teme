import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import type { MessageKey, Translate } from "@/lib/i18n/translator";

const BY_CODE: Record<string, MessageKey> = {
  LAST_OWNER: "team.errLastOwner",
  LAST_ACTIVE_BRANCH: "branches.errLastActive",
  INVITE_NOT_POSSIBLE: "team.errInviteNotPossible",
};

/**
 * What a refused change means, in words. The backend's coded refusals (last owner, last active branch, an address
 * that cannot be invited) have their own wording. Other 403 and 409 answers reuse the same code for several
 * reasons, so the caller says which one it expects for what it just tried; anything else falls back to the
 * general messages. The backend's own English text is never shown.
 */
export function explainOrgError(
  error: unknown,
  t: Translate,
  context: { forbidden?: MessageKey; conflict?: MessageKey; invalid?: MessageKey } = {},
): string {
  const e = toApiError(error);
  const coded = BY_CODE[e.code];
  if (coded) return t(coded);
  if (e.kind === "forbidden" && context.forbidden) return t(context.forbidden);
  if (e.kind === "conflict" && context.conflict) return t(context.conflict);
  if (e.kind === "validation" && context.invalid) return t(context.invalid);
  if (e.kind === "validation") return t("errors.validation");
  return describeApiError(e, t).description;
}
