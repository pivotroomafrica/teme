"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, ButtonLink } from "@/components/ui";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { cardClient } from "../card-client";

/** No card on this phone: say how to get one instead of showing an empty page. */
export function CardEmpty() {
  const { t, locale } = useI18n();
  return (
    <section
      aria-labelledby="card-title"
      className="flex flex-col gap-4 pt-8"
      data-testid="card-empty"
    >
      <h1 id="card-title" className="text-2xl font-bold text-green-900">
        {t("card.emptyTitle")}
      </h1>
      <p className="text-lg text-charcoal-700">{t("card.emptyBody")}</p>
      <div>
        <ButtonLink href={`/${locale}`} variant="secondary">
          {t("common.goHome")}
        </ButtonLink>
      </div>
    </section>
  );
}

/**
 * The card is saved but could not be loaded right now (busy, offline, unavailable). The card stays on the phone,
 * and trying again is safe because loading a card changes nothing.
 */
export function CardLoadFailed({ message, href }: { message: string; href: string }) {
  const { t } = useI18n();
  return (
    <section
      aria-labelledby="card-title"
      className="flex flex-col gap-4 pt-8"
      data-testid="card-load-failed"
    >
      <h1 id="card-title" className="text-2xl font-bold text-green-900">
        {t("card.loadFailedTitle")}
      </h1>
      <div role="alert" className="rounded-card border border-red-600/40 bg-red-50 p-4">
        {message}
      </div>
      <p className="text-charcoal-700">{t("card.loadFailedBody")}</p>
      {/* A plain link: reloading repeats the safe read and works before any script has loaded. */}
      <div>
        <a
          href={href}
          className="touch-target inline-flex items-center rounded-control bg-primary px-5 font-semibold text-on-primary no-underline hover:bg-primary-hover"
        >
          {t("common.retry")}
        </a>
      </div>
    </section>
  );
}

/** The backend no longer knows this card. Offer to take it off the phone. */
export function CardGone({ cardId }: { cardId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setProblem(null);
    try {
      await cardClient.forget(cardId);
      router.replace(`/${locale}/card`);
      router.refresh();
    } catch (e) {
      setProblem(describeApiError(toApiError(e), t).description);
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="card-title"
      className="flex flex-col gap-4 pt-8"
      data-testid="card-gone"
    >
      <h1 id="card-title" className="text-2xl font-bold text-green-900">
        {t("card.goneTitle")}
      </h1>
      <p className="text-lg text-charcoal-700">{t("card.goneBody")}</p>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <div>
        <Button variant="danger" loading={busy} onClick={() => void remove()}>
          {t("card.removeCard")}
        </Button>
      </div>
    </section>
  );
}
