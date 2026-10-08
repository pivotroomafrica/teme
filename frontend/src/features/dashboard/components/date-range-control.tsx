"use client";

import { useState, type FormEvent } from "react";
import { Button, FormField, Input, Select } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import { PRESETS, checkRange, type Preset, type Range } from "../range";

const PRESET_LABEL: Record<Preset, MessageKey> = {
  last7: "dashboard.presetLast7",
  last30: "dashboard.presetLast30",
  last90: "dashboard.presetLast90",
  thisMonth: "dashboard.presetThisMonth",
  lastMonth: "dashboard.presetLastMonth",
};

const PROBLEM_TEXT = {
  invalid: "dashboard.rangeInvalid",
  order: "dashboard.rangeOrder",
  tooLong: "dashboard.rangeTooLong",
} as const satisfies Record<string, MessageKey>;

/**
 * Chooses the days a page covers: a ready-made period, or two dates. The dates are calendar days in the business
 * time zone (the backend reads them that way), and a range the backend would refuse is explained here first.
 */
export function DateRangeControl({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: Preset | "custom";
  range: Range;
  onPreset: (preset: Preset) => void;
  onCustom: (range: Range) => void;
}) {
  const { t } = useI18n();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [problem, setProblem] = useState<keyof typeof PROBLEM_TEXT | null>(null);
  const [custom, setCustom] = useState(preset === "custom");

  function apply(event: FormEvent) {
    event.preventDefault();
    const found = checkRange(from, to);
    setProblem(found);
    if (!found) onCustom({ from, to });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="date-range">
      <div className="max-w-xs">
        <FormField label={t("dashboard.periodLabel")}>
          <Select
            value={custom ? "custom" : preset}
            onChange={(event) => {
              if (event.target.value === "custom") {
                setCustom(true);
                return;
              }
              setCustom(false);
              setProblem(null);
              onPreset(event.target.value as Preset);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(PRESET_LABEL[p])}
              </option>
            ))}
            <option value="custom">{t("dashboard.presetCustom")}</option>
          </Select>
        </FormField>
      </div>

      {custom ? (
        <form onSubmit={apply} noValidate className="flex flex-wrap items-end gap-3">
          <FormField label={t("dashboard.from")}>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </FormField>
          <FormField label={t("dashboard.to")}>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </FormField>
          <Button type="submit">{t("dashboard.apply")}</Button>
          {problem ? (
            <p role="alert" className="basis-full text-sm font-medium text-red-700">
              {t(PROBLEM_TEXT[problem])}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
