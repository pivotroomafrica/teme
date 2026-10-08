import { redirect } from "next/navigation";
import { WalletSelector } from "@/features/wallet/wallet-selector";
import { pickCard } from "@/lib/card/cards";
import { readCards } from "@/lib/card/server";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
};

export const generateMetadata = ({ params }: Props) => pageMetadata(params, "wallet.screenTitle");

/** Add the card to Apple Wallet or Google Wallet, or keep using the web card. Needs a card on this phone. */
export default async function WalletPage({ params, searchParams }: Props) {
  const locale = assertLocale((await params).locale);
  const requested = (await searchParams).c;
  const card = pickCard(await readCards(), typeof requested === "string" ? requested : undefined);
  if (!card) redirect(`/${locale}/card`);

  const t = await getTranslator(locale);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "card",
    "wallet",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <section className="flex flex-col gap-4 py-6">
        <h1 className="text-2xl font-bold text-green-900">{t("wallet.screenTitle")}</h1>
        <WalletSelector
          cardId={card.id}
          webCardHref={`/${locale}/card?c=${encodeURIComponent(card.id)}`}
        />
      </section>
    </I18nProvider>
  );
}
