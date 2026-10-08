"use client";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/client";
import { OFFICIAL_WALLET_BUTTONS } from "./brand";
import type { WalletProvider } from "./device";

/**
 * "Add to Apple Wallet" / "Add to Google Wallet". When the official artwork has been installed (see
 * `brand.ts`) the button shows it, unmodified, with the same words as its accessible name. Until then it is a
 * plain black button with white text and no company logo.
 */
export function WalletButton({
  provider,
  label,
  disabled,
  loading,
  onClick,
}: {
  provider: WalletProvider;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const { locale } = useI18n();
  const official = OFFICIAL_WALLET_BUTTONS[provider];
  const src = official ? (locale === "am" ? (official.am ?? official.en) : official.en) : null;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={src ? label : undefined}
      onClick={onClick}
      className={cn(
        "touch-target inline-flex w-full items-center justify-center rounded-control",
        src
          ? "bg-transparent p-0 disabled:opacity-50"
          : "min-h-14 bg-black px-6 text-lg font-semibold text-white hover:bg-charcoal-900 disabled:opacity-50",
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- official artwork must be shown unmodified
        <img src={src} alt="" height={48} className="h-12 w-auto" />
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}
