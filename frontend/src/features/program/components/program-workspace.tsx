"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Select,
  Skeleton,
  SkeletonGroup,
  Tabs,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import type { Program } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { pickLocalized } from "@/features/enrollment/localized";
import type { PosterLanguage } from "../qr-links";
import { JoinMaterials, type JoinCode } from "./join-materials";
import type { PosterMessages } from "./poster";
import { ProgramEditor } from "./program-editor";

const NEW = "new";
const STATUS_LABEL = {
  DRAFT: "loyalty.statusDraft",
  ACTIVE: "loyalty.statusActive",
  PAUSED: "loyalty.statusPaused",
  ARCHIVED: "loyalty.statusArchived",
} as const;
const STATUS_TONE: Record<Program["status"], Tone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "neutral",
};

/**
 * The program builder: pick a program (or start a new one), edit it with live previews, and print the join
 * materials. The list comes from the backend, and every change is saved there before it is shown as saved.
 */
export function ProgramWorkspace({
  canManage,
  merchant,
  codes,
  posterMessages,
}: {
  canManage: boolean;
  merchant: { nameEn: string; nameAm: string | null };
  codes: Record<PosterLanguage, JoinCode> | null;
  posterMessages: PosterMessages;
}) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["programs"],
    queryFn: ({ signal }) => getBrowserApi().programs.list(signal),
  });
  const [choice, setChoice] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <SkeletonGroup className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    const failure = toApiError(query.error);
    return (
      <ErrorState
        title={t("program.loadErrorTitle")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const programs = query.data;
  const live = programs.find((p) => p.isDefault && p.status === "ACTIVE") ?? null;
  const fallback = live ?? programs.find((p) => p.status !== "ARCHIVED") ?? programs[0] ?? null;
  const selectedId = choice ?? fallback?.id ?? (canManage ? NEW : null);
  const selected =
    selectedId === NEW ? null : (programs.find((p) => p.id === selectedId) ?? fallback);

  if (programs.length === 0 && !canManage) {
    return <EmptyState title={t("program.noPrograms")} />;
  }

  function changed(program: Program) {
    client.setQueryData<Program[]>(["programs"], (current = []) =>
      current.some((p) => p.id === program.id)
        ? current.map((p) => (p.id === program.id ? program : p))
        : [...current, program],
    );
    setChoice(program.id);
    // Activating one program does not change the others in this list; ask again for the truth.
    void client.invalidateQueries({ queryKey: ["programs"] });
  }

  const posterProgram = live ?? selected;
  const label = (p: Program) => {
    const name = pickLocalized(locale, p.nameEn, p.nameAm).text;
    return `${name} (${t(STATUS_LABEL[p.status])})`;
  };

  return (
    <div className="flex flex-col gap-6">
      {programs.length > 0 ? (
        <div className="flex flex-wrap items-end gap-4">
          <div className="max-w-sm min-w-0 flex-1">
            <FormField label={t("program.listLabel")}>
              <Select value={selectedId ?? ""} onChange={(event) => setChoice(event.target.value)}>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
                {selectedId === NEW ? (
                  <option value={NEW}>{t("program.createTitle")}</option>
                ) : null}
              </Select>
            </FormField>
          </div>
          {selected ? (
            <Badge tone={STATUS_TONE[selected.status]}>{t(STATUS_LABEL[selected.status])}</Badge>
          ) : null}
          {canManage && selectedId !== NEW ? (
            <Button variant="secondary" onClick={() => setChoice(NEW)}>
              {t("program.newProgram")}
            </Button>
          ) : null}
        </div>
      ) : (
        <EmptyState title={t("program.noPrograms")} description={t("program.noProgramsBody")} />
      )}

      <Tabs
        label={t("nav.program")}
        tabs={[
          {
            id: "program",
            label: t("program.tabProgram"),
            content: (
              <ProgramEditor
                key={selected?.id ?? NEW}
                program={selected}
                canManage={canManage}
                merchant={merchant}
                otherActive={Boolean(live && live.id !== selected?.id)}
                onChanged={changed}
              />
            ),
          },
          {
            id: "qr",
            label: t("program.tabQr"),
            content: (
              <JoinMaterials
                codes={codes}
                merchant={merchant}
                program={posterProgram}
                programIsLive={Boolean(live)}
                posterMessages={posterMessages}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
