import Link from "next/link";
import { CardClaim } from "@/features/card/components/card-claim";
import { CardEmpty, CardGone, CardLoadFailed } from "@/features/card/components/card-states";
import { WebCardView } from "@/features/card/components/web-card-view";
import { qrSvg } from "@/features/card/qr";
import { pickLocalized } from "@/features/enrollment/localized";
import { getServerApi } from "@/lib/api/server";
import { publicEnv } from "@/lib/config/public-env";
import { pickCard } from "@/lib/card/cards";
import { readCards } from "@/lib/card/server";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { I18nProvider } from "@/lib/i18n/client";
import { getFormatter, assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
};

// The customer's card is private to the phone it is on: never indexed (pageMetadata), never cached.
export const generateMetadata = ({ params }: Props) => pageMetadata(params, "areas.card");

/** Loads the card and its QR code. A card the backend no longer knows is "gone"; anything else is a problem to retry. */
async function loadCard(token: string) {
  try {
    const card = await (await getServerApi()).card.getWebCard(token);
    return { status: "ok" as const, card, qr: await qrSvg(card.barcode) };
  } catch (e) {
    const error = toApiError(e);
    return error.kind === "not_found"
      ? { status: "gone" as const }
      : { status: "problem" as const, error };
  }
}

export default async function CardPage({ params, searchParams }: Props) {
  const locale = assertLocale((await params).locale);
  const requested = (await searchParams).c;
  const t = await getTranslator(locale);
  const cards = await readCards();
  const selected = pickCard(cards, typeof requested === "string" ? requested : undefined);
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

  const loaded = selected ? await loadCard(selected.token) : null;
  const here = selected ? `/${locale}/card?c=${encodeURIComponent(selected.id)}` : "";

  let body: React.ReactNode;
  if (!selected || !loaded) {
    body = <CardEmpty />;
  } else if (loaded.status === "ok") {
    body = (
      <WebCardView
        card={loaded.card}
        qr={loaded.qr}
        cardId={selected.id}
        locale={locale}
        t={t}
        format={getFormatter(locale)}
        fetchedAt={new Date()}
        supportUrl={publicEnv.NEXT_PUBLIC_SUPPORT_URL}
      />
    );
  } else if (loaded.status === "gone") {
    body = <CardGone cardId={selected.id} />;
  } else {
    body = <CardLoadFailed message={describeApiError(loaded.error, t).description} href={here} />;
  }

  const others = cards.filter((c) => c.id !== selected?.id);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <CardClaim />
      {body}
      {others.length > 0 ? (
        <nav aria-labelledby="other-cards" className="mt-8">
          <h2 id="other-cards" className="font-bold text-green-900">
            {t("card.yourCards")}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {others.map((other) => {
              const name = pickLocalized(locale, other.merchantEn, other.merchantAm);
              return (
                <li key={other.id}>
                  <Link
                    href={`/${locale}/card?c=${encodeURIComponent(other.id)}`}
                    lang={name.lang}
                    className="touch-target inline-flex items-center"
                  >
                    {name.text}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </I18nProvider>
  );
}
