import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components/login-form";
import { homeFor } from "@/lib/auth/permissions";
import { loadAuth } from "@/lib/auth/server";
import { assertLocale, getTranslator } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) =>
  pageMetadata(params, "auth.loginTitle");

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  const { next } = await searchParams;

  // Someone who is already signed in has no use for the form: take them home.
  const state = await loadAuth();
  if (state.status === "ok") redirect(`/${locale}${homeFor(state.principal)}`);

  return (
    <section aria-labelledby="login-title">
      <h1 id="login-title" className="text-2xl font-bold text-green-900">
        {t("auth.loginTitle")}
      </h1>
      <p className="mt-2 mb-6 text-muted">{t("auth.loginIntro")}</p>
      {/* The server re-validates `next` after sign-in; only a plain string is passed along. */}
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </section>
  );
}
