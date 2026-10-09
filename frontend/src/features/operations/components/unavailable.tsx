"use client";

import { Alert } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";

/**
 * States plainly that the service does not offer something, instead of showing an empty or invented screen. The
 * operations console only does what the backend supports; everything else is listed here and in docs/operations.md.
 */
export function Unavailable({ title, items }: { title?: string; items?: readonly MessageKey[] }) {
  const { t } = useI18n();
  return (
    <Alert tone="info" title={title ?? t("ops.unavailableTitle")}>
      <p>{t("ops.unavailableBody")}</p>
      {items && items.length > 0 ? (
        <ul className="mt-2 list-disc ps-5">
          {items.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}
