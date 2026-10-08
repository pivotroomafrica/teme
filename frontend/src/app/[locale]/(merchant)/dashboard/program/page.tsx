import { PageHeading } from "@/components/ui";
import { ProgramWorkspace } from "@/features/program/components/program-workspace";
import { isJoinReference, joinUrl, type PosterLanguage } from "@/features/program/qr-links";
import { qrSvg } from "@/features/card/qr";
import { getServerApi } from "@/lib/api/server";
import { requireRoute } from "@/lib/auth/server";
import { publicEnv } from "@/lib/config/public-env";
import { I18nProvider } from "@/lib/i18n/client";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "nav.program");

const LANGUAGES: PosterLanguage[] = ["en", "am", "both"];

export default async function ProgramPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const ctx = await requireRoute(locale, "/dashboard/program");
  const t = await getTranslator(locale);

  // The business name and public join reference come from the backend. If the profile cannot be read the page
  // still works; only the QR materials say they are unavailable.
  const profile = await (
    await getServerApi({ accessToken: ctx.session.accessToken })
  ).merchant
    .getProfile()
    .catch(() => null);
  const reference = profile?.joinReference;
  const codes =
    profile && isJoinReference(reference)
      ? (Object.fromEntries(
          await Promise.all(
            LANGUAGES.map(async (language) => {
              const url = joinUrl(publicEnv.NEXT_PUBLIC_APP_URL, reference, language);
              return [language, { url, svg: await qrSvg(url) }] as const;
            }),
          ),
        ) as Record<PosterLanguage, { url: string; svg: string }>)
      : null;

  const [english, amharic] = await Promise.all([getMessages("en"), getMessages("am")]);
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
    "enrollment",
    "card",
    "loyalty",
    "program",
  ]);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <PageHeading title={t("nav.program")} />
      <ProgramWorkspace
        canManage={ctx.principal.permissions.includes("program:manage")}
        merchant={{ nameEn: profile?.nameEn ?? "", nameAm: profile?.nameAm ?? null }}
        codes={codes}
        posterMessages={{ en: english.poster, am: amharic.poster }}
      />
    </I18nProvider>
  );
}
