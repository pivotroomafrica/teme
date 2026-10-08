"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { cardClient } from "../card-client";

/** `#t=<token>` in the address, or null. Anything that is not a plain card token is ignored. */
export function tokenFromHash(hash: string): string | null {
  const match = /^#t=([A-Za-z0-9._~%-]{8,400})$/.exec(hash);
  if (!match) return null;
  try {
    const token = decodeURIComponent(match[1]!);
    return /^[A-Za-z0-9._~-]{8,256}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * Picks up a card handed over in the address fragment (`/card#t=…`), puts it on this device through the server,
 * and removes it from the address bar so it is not left in the history, a screenshot or a shared link. Renders
 * nothing when there is no fragment.
 */
export function CardClaim() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [state, setState] = useState<
    { phase: "idle" } | { phase: "saving" } | { phase: "failed"; message: string; token: string }
  >({ phase: "idle" });
  const started = useRef(false);

  async function claim(token: string) {
    setState({ phase: "saving" });
    try {
      const { id } = await cardClient.claim(token);
      history.replaceState(null, "", `/${locale}/card`);
      router.replace(`/${locale}/card?c=${encodeURIComponent(id)}`);
      // The card page now shows the saved card; this notice has done its job.
      setState({ phase: "idle" });
    } catch (e) {
      const error = toApiError(e);
      setState({
        phase: "failed",
        token,
        message:
          error.kind === "not_found" || error.kind === "validation"
            ? t("card.claimInvalid")
            : describeApiError(error, t).description,
      });
    }
  }

  useEffect(() => {
    if (started.current) return;
    const token = tokenFromHash(window.location.hash);
    if (!token) return;
    started.current = true;
    // Gone from the address at once; the token stays only in this function until the server has it.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the address fragment, which only exists in the browser
    void claim(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on arrival
  }, []);

  if (state.phase === "idle") return null;
  if (state.phase === "saving") {
    return (
      <p role="status" className="py-6 text-center text-muted">
        {t("card.claiming")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 py-6">
      <Alert tone="danger" title={t("card.claimFailedTitle")}>
        {state.message}
      </Alert>
      <div>
        <Button onClick={() => void claim(state.token)}>{t("common.retry")}</Button>
      </div>
    </div>
  );
}
