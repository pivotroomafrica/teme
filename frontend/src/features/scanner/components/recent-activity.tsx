"use client";

import { CheckCircleIcon, XCircleIcon } from "@/components/ui/icons";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { RecentEntry } from "../scanner-flow";

/**
 * What this phone just did. It lives only in the page's memory (gone when staff leave or reload) and shows a
 * first name, what happened and when: never a phone number, card code or any other identifier.
 */
export function RecentActivity({ entries }: { entries: RecentEntry[] }) {
  const { t } = useI18n();
  const format = useFormat();
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-2">
      <h2 id="recent-title" className="text-lg font-bold text-green-900">
        {t("scanner.recentTitle")}
      </h2>
      {entries.length === 0 ? (
        <p className="text-muted">{t("scanner.recentEmpty")}</p>
      ) : (
        <ul
          className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface"
          data-testid="recent-list"
        >
          {entries.map((entry) => {
            const name = entry.name || t("scanner.customerFallback");
            const label =
              entry.kind === "stamp"
                ? t("scanner.recentStamp", { name })
                : entry.kind === "redeem"
                  ? t("scanner.recentRedeem", { name })
                  : t("scanner.recentRejected", { name });
            const Icon = entry.kind === "rejected" ? XCircleIcon : CheckCircleIcon;
            return (
              <li key={entry.id} className="flex items-center gap-3 p-3">
                <Icon
                  size={24}
                  className={
                    entry.kind === "rejected" ? "shrink-0 text-red-700" : "shrink-0 text-green-700"
                  }
                />
                <span className="min-w-0 flex-1 break-words">{label}</span>
                <time
                  className="shrink-0 text-sm text-muted"
                  dateTime={new Date(entry.at).toISOString()}
                >
                  {format.time(entry.at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm text-muted">{t("scanner.recentNote")}</p>
    </section>
  );
}
