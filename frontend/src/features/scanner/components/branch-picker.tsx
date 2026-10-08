"use client";

import { useState } from "react";
import { Alert, Button, RadioGroup } from "@/components/ui";
import type { Branch } from "@/features/branches/api";
import { sessionClient } from "@/features/auth/session-client";
import { useHydrated } from "@/hooks/use-hydrated";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";

/**
 * Lets branch staff pick where they are working. Only branches the backend lists for this account appear, and the
 * server checks the choice again before remembering it.
 */
export function BranchPicker({ branches, currentId }: { branches: Branch[]; currentId?: string }) {
  const { t, locale } = useI18n();
  const [value, setValue] = useState(currentId ?? branches[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hydrated = useHydrated();

  async function choose() {
    setBusy(true);
    setProblem(null);
    try {
      await sessionClient.selectBranch(value);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/${locale}/staff/scanner`);
    } catch (e) {
      setProblem(describeApiError(toApiError(e), t).description);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5" data-hydrated={hydrated}>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <RadioGroup
        name="branch"
        legend={t("auth.currentBranch")}
        value={value}
        onValueChange={setValue}
        options={branches.map((b) => ({
          value: b.id,
          label: locale === "am" && b.nameAm ? b.nameAm : b.nameEn,
          description: b.city ?? undefined,
        }))}
      />
      <Button size="lg" fullWidth onClick={choose} loading={busy} disabled={!value}>
        {t("auth.useThisBranch")}
      </Button>
    </div>
  );
}
