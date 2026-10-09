import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-ethiopic";
import "../globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { publicEnv } from "@/lib/config/public-env";
import { I18nProvider } from "@/lib/i18n/client";
import { localeTags, locales } from "@/lib/i18n/config";
import { assertLocale, getMessages, getTranslator } from "@/lib/i18n/server";
import { pickNamespaces } from "@/lib/i18n/translator";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// Only the supported languages exist; anything else is a 404 rather than a runtime error.
export const dynamicParams = false;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b5e3a",
  colorScheme: "light",
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslator(locale);
  return {
    metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
    title: { default: t("common.appName"), template: `%s | ${t("common.appName")}` },
    description: t("common.tagline"),
    applicationName: t("common.appName"),
    openGraph: {
      title: t("common.appName"),
      description: t("common.tagline"),
      locale: localeTags[locale].replace("-", "_"),
      type: "website",
    },
  };
}

export default async function RootLayout({ children, params }: Props) {
  const locale = assertLocale((await params).locale);
  // Every page is rendered per request: the Content-Security-Policy carries a fresh nonce that Next.js must stamp on
  // each page's scripts, which a prerendered (static) page cannot have. Reading the request headers opts in.
  await headers();
  const messages = pickNamespaces(await getMessages(locale), [
    "common",
    "errors",
    "ui",
    "nav",
    "auth",
    "areas",
  ]);

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full">
        <I18nProvider locale={locale} messages={messages}>
          <AppProviders>{children}</AppProviders>
        </I18nProvider>
      </body>
    </html>
  );
}
