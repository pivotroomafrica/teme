"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";

export interface NavLink {
  id: string;
  href: string;
  label: string;
}

/**
 * Navigation for one area. The list already contains only the entries the person may open (the server decided);
 * this component just renders it. Below the `md` breakpoint the list folds behind a "Menu" button so a long
 * Amharic label never has to squeeze into a header. The current page is marked with aria-current.
 */
export function AreaNav({
  items,
  label,
  orientation = "horizontal",
}: {
  items: NavLink[];
  label: string;
  orientation?: "horizontal" | "vertical";
}) {
  const pathname = usePathname() ?? "";
  const t = useT();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hydrated = useHydrated();
  if (items.length === 0) return null;

  // "/en/dashboard" must not mark every dashboard page as current: exact match, or a deeper path of a
  // non-root entry.
  const isCurrent = (href: string) =>
    pathname === href ||
    (items.some((i) => i.href !== href && i.href.startsWith(`${href}/`))
      ? false
      : pathname.startsWith(`${href}/`));

  return (
    <nav aria-label={label} className="min-w-0" data-hydrated={hydrated}>
      {items.length > 1 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="touch-target rounded-control border border-border bg-surface px-4 font-semibold text-green-900 md:hidden"
        >
          {t("nav.menu")}
        </button>
      ) : null}
      <ul
        id={listId}
        className={cn(
          "mt-2 flex-col gap-1 md:mt-0 md:flex",
          open ? "flex" : "hidden",
          orientation === "horizontal" ? "md:flex-row md:flex-wrap" : "md:w-56",
        )}
      >
        {items.map((item) => {
          const current = isCurrent(item.href);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "touch-target flex items-center rounded-control px-3 py-2 font-medium no-underline",
                  current ? "bg-green-700 text-white" : "text-charcoal-900 hover:bg-cream-200",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
