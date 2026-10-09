import { AcceptInvitationForm } from "@/features/auth/components/accept-invitation-form";
import { assertLocale, getTranslator } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "auth.acceptTitle");

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  return (
    <section aria-labelledby="accept-title">
      <h1 id="accept-title" className="text-2xl font-bold text-green-900">
        {t("auth.acceptTitle")}
      </h1>
      <p className="mt-2 mb-6 text-muted">{t("auth.acceptIntro")}</p>
      <AcceptInvitationForm />
    </section>
  );
}
