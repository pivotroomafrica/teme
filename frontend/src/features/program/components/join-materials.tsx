"use client";

import { useState } from "react";
import { Alert, Button, RadioGroup } from "@/components/ui";
import type { Program } from "@/lib/api/contract";
import { useI18n } from "@/lib/i18n/client";
import { downloadBlob, downloadSvg, svgToPng } from "../qr-download";
import type { PosterLanguage } from "../qr-links";
import { Poster, type PosterMessages } from "./poster";

export interface JoinCode {
  url: string;
  svg: string;
}

/**
 * The join QR code and printable posters. The codes are made on the server from the business's public join
 * reference (supplied by the backend); this screen only lets the owner pick a language, download the code, or
 * print the poster. It shows plainly what is not possible yet: one code per branch (the join link is the same for
 * every branch) and the business logo (upload does not exist yet).
 */
export function JoinMaterials({
  codes,
  merchant,
  program,
  programIsLive,
  posterMessages,
}: {
  /** Null when the backend gave no join reference. */
  codes: Record<PosterLanguage, JoinCode> | null;
  merchant: { nameEn: string; nameAm: string | null };
  /** The program the poster talks about (the live one if there is one). */
  program: Program | null;
  /** Customers can join it right now (it is the active default). */
  programIsLive: boolean;
  posterMessages: PosterMessages;
}) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<PosterLanguage>("both");
  const [problem, setProblem] = useState<string | null>(null);

  if (!codes) {
    return <Alert tone="warning">{t("program.qrNoReference")}</Alert>;
  }
  const code = codes[language];
  const stem = `join-qr-${language}`;

  async function savePng() {
    setProblem(null);
    try {
      downloadBlob(await svgToPng(code.svg), `${stem}.png`);
    } catch {
      setProblem(t("errors.unexpected"));
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="join-materials">
      <header>
        <h2 className="text-xl font-bold text-green-900">{t("program.qrTitle")}</h2>
        <p className="mt-1 max-w-prose text-charcoal-700">{t("program.qrIntro")}</p>
      </header>

      {!programIsLive ? <Alert tone="warning">{t("program.qrNeedsActive")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 print:hidden">
          <RadioGroup
            name="poster-language"
            legend={t("program.qrLanguage")}
            value={language}
            onValueChange={(value) => setLanguage(value as PosterLanguage)}
            options={[
              { value: "en", label: t("program.qrEnglish") },
              { value: "am", label: t("program.qrAmharic") },
              {
                value: "both",
                label: t("program.qrBilingual"),
                description: t("program.qrBilingualNote"),
              },
            ]}
          />
          <div>
            <p className="text-sm font-medium">{t("program.qrLink")}</p>
            <p className="font-mono text-sm break-all text-charcoal-700" data-testid="join-link">
              {code.url}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => downloadSvg(code.svg, `${stem}.svg`)}>
              {t("program.qrDownloadSvg")}
            </Button>
            <Button variant="secondary" onClick={() => void savePng()}>
              {t("program.qrDownloadPng")}
            </Button>
          </div>
          <div>
            <Button onClick={() => window.print()}>{t("program.qrPrint")}</Button>
            <p className="mt-1 text-sm text-muted">{t("program.qrPrintHint")}</p>
          </div>

          <section
            aria-labelledby="branch-qr"
            className="rounded-card border border-border bg-surface p-4"
          >
            <h3 id="branch-qr" className="font-bold text-green-900">
              {t("program.qrBranchTitle")}
            </h3>
            <p className="mt-1 text-charcoal-700" data-testid="branch-qr-unavailable">
              {t("program.qrBranchUnavailable")}
            </p>
          </section>
          <p className="text-sm text-muted">{t("program.qrLogoNote")}</p>
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 font-bold text-green-900 print:hidden">
            {t("program.qrPosterPreview")}
          </h3>
          {program ? (
            <Poster
              language={language}
              qrSvg={code.svg}
              url={code.url}
              merchant={merchant}
              program={program}
              messages={posterMessages}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
