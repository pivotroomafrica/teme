import type { Metadata } from "next";
import Link from "next/link";
import { assertLocale, getTranslator } from "@/lib/i18n/server";

/** The home page is the one indexable page, so it alone declares its canonical address and its translations. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  return { alternates: { canonical: `/${locale}`, languages: { en: "/en", am: "/am" } } };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  return (
    <section aria-labelledby="home-title" className="py-10">
      <h1 id="home-title" className="text-3xl font-bold text-green-800 sm:text-4xl">
        {t("common.appName")}
      </h1>
      <p className="mt-3 text-lg text-charcoal-700">{t("common.tagline")}</p>
      <p className="mt-8">
        <Link
          href={"/" + locale + "/login"}
          className="touch-target inline-flex items-center rounded-control bg-primary px-6 font-semibold text-on-primary no-underline hover:bg-primary-hover"
        >
          {t("areas.login")}
        </Link>
      </p>
    </section>
  );
}
