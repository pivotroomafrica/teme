"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, ButtonLink, ConfirmationScreen } from "@/components/ui";
import type { WalletOption } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { cardClient } from "@/features/card/card-client";
import { WalletSelector } from "@/features/wallet/wallet-selector";

type Saving =
  { phase: "saving" } | { phase: "saved"; id: string } | { phase: "failed"; message: string };

/**
 * The step after a new membership. The card token the backend just returned is shown nowhere: it is handed to
 * this app's server, which checks it and keeps it in a sealed HttpOnly cookie, and from then on the browser
 * refers to the card by an opaque id. If saving fails the customer can retry; the token stays in this page's
 * memory only for that, and `/card#t=…` (read once by the card page) is the fallback.
 */
export function EnrollmentDone({ token, wallet }: { token: string; wallet: WalletOption[] }) {
  const { t, locale } = useI18n();
  const [saving, setSaving] = useState<Saving>({ phase: "saving" });
  const started = useRef(false);

  const save = useCallback(async () => {
    setSaving({ phase: "saving" });
    try {
      const { id } = await cardClient.claim(token);
      setSaving({ phase: "saved", id });
    } catch (e) {
      setSaving({ phase: "failed", message: describeApiError(toApiError(e), t).description });
    }
  }, [token, t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void save();
  }, [save]);

  return (
    <div className="flex flex-col gap-6" data-testid="enrollment-created">
      <ConfirmationScreen
        headingLevel="h2"
        title={t("enrollment.successTitle")}
        description={t("enrollment.successBody")}
      />

      {saving.phase === "saving" ? (
        <p role="status" className="text-center text-muted">
          {t("card.claiming")}
        </p>
      ) : null}

      {saving.phase === "failed" ? (
        <div className="flex flex-col gap-3">
          <Alert tone="danger" title={t("card.claimFailedTitle")}>
            {saving.message}
          </Alert>
          <Alert tone="warning">{t("enrollment.saveNow")}</Alert>
          <Button size="lg" fullWidth onClick={() => void save()}>
            {t("common.retry")}
          </Button>
          <ButtonLink
            href={`/${locale}/card#t=${encodeURIComponent(token)}`}
            variant="secondary"
            fullWidth
          >
            {t("wallet.openWebCard")}
          </ButtonLink>
        </div>
      ) : null}

      {saving.phase === "saved" ? (
        <WalletSelector
          cardId={saving.id}
          availability={wallet}
          webCardHref={`/${locale}/card?c=${encodeURIComponent(saving.id)}`}
        />
      ) : null}
    </div>
  );
}
