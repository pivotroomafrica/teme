"use client";

import { useQuery } from "@tanstack/react-query";
import { FormField, Select } from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { getBrowserApi } from "@/lib/api/browser";
import type { PlatformMerchant } from "@/lib/api/contract";
import { useI18n } from "@/lib/i18n/client";

/** The merchants for a select, shared with the list screens through the same query. */
export function useMerchants() {
  return useQuery({
    queryKey: ["ops", "merchants"],
    queryFn: ({ signal }) => getBrowserApi().operations.merchants(signal),
  });
}

export function MerchantPicker({
  label,
  placeholder,
  value,
  onChange,
  merchants,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (merchant: PlatformMerchant | null) => void;
  merchants: readonly PlatformMerchant[];
}) {
  const { locale } = useI18n();
  return (
    <FormField label={label}>
      <Select
        value={value}
        onChange={(event) => onChange(merchants.find((m) => m.id === event.target.value) ?? null)}
      >
        <option value="">{placeholder}</option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {pickLocalized(locale, m.nameEn, m.nameAm).text}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
