"use client";

import { useState } from "react";
import { Alert, ButtonLink } from "@/components/ui";
import type { WalletOption } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { useI18n } from "@/lib/i18n/client";
import { cardClient } from "@/features/card/card-client";
import { walletProvidersFor, type WalletPlatform, type WalletProvider } from "./device";
import { useWalletPlatform } from "./use-wallet-platform";
import { WalletButton } from "./wallet-button";

interface Props {
  /** Which card on this device (omit for the newest). */
  cardId?: string;
  /** Wallet availability the backend reported at sign-up; unknown later, then the backend answers on press. */
  availability?: WalletOption[];
  /** Where the always-available web card lives. */
  webCardHref: string;
  /** For tests; normally the phone is detected in the browser. */
  platform?: WalletPlatform;
}

/**
 * Keep-your-card screen. Says plainly that this is a loyalty card, offers the wallets that make sense for this
 * phone (both when the phone cannot be told reliably), and always offers the web card. The wallet link is
 * created by the backend (which holds the signing credentials); the browser only opens the address it is given.
 */
export function WalletSelector({ cardId, availability, webCardHref, platform }: Props) {
  const { t } = useI18n();
  const detected = useWalletPlatform();
  const providers = walletProvidersFor(platform ?? detected);
  const [opening, setOpening] = useState<WalletProvider | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const labels: Record<WalletProvider, string> = {
    APPLE: t("wallet.addApple"),
    GOOGLE: t("wallet.addGoogle"),
  };
  const availableFor = (provider: WalletProvider) =>
    availability ? (availability.find((o) => o.provider === provider)?.available ?? false) : true;

  async function open(provider: WalletProvider) {
    setProblem(null);
    setOpening(provider);
    try {
      const link = await cardClient.walletLink(provider, cardId);
      if (link.url && /^https:\/\//.test(link.url)) {
        window.location.assign(link.url);
        return;
      }
      setProblem(t("wallet.linkFailed"));
    } catch (e) {
      // A wallet the business has not set up answers 409; anything else is a failure to reach it.
      setProblem(
        toApiError(e).kind === "conflict" ? t("wallet.notOfferedNow") : t("wallet.linkFailed"),
      );
    } finally {
      setOpening(null);
    }
  }

  return (
    <section
      aria-labelledby="wallet-title"
      className="flex flex-col gap-4"
      data-testid="wallet-selector"
    >
      <h2 id="wallet-title" className="text-xl font-bold text-green-900">
        {t("wallet.chooseTitle")}
      </h2>
      <p className="text-charcoal-700">{t("wallet.notPaymentCard")}</p>

      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      <ul className="flex flex-col gap-3">
        {providers.map((provider) => {
          const available = availableFor(provider);
          return (
            <li key={provider} className="flex flex-col gap-1">
              <WalletButton
                provider={provider}
                label={labels[provider]}
                disabled={!available}
                loading={opening === provider}
                onClick={() => void open(provider)}
              />
              {!available ? (
                <span className="text-sm text-muted">{t("wallet.statusUnavailable")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1">
        <ButtonLink
          href={webCardHref}
          variant={providers.length ? "secondary" : "primary"}
          size="lg"
          fullWidth
        >
          {t("wallet.openWebCard")}
        </ButtonLink>
        <p className="text-sm text-muted">{t("wallet.webCardNote")}</p>
      </div>
    </section>
  );
}
