"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "./icons";
import { buttonClasses } from "./button";

export interface MenuItem {
  id: string;
  label: ReactNode;
  onSelect?: () => void;
  /** Renders a link instead of a button. */
  href?: string;
  /** Destructive entries are red and should be last. */
  tone?: "default" | "danger";
  disabled?: boolean;
}

/**
 * Action menu following the WAI-ARIA menu-button pattern: Enter/Space/ArrowDown opens it and focuses the first
 * item, arrows / Home / End move, Escape closes and returns focus to the button, Tab or an outside click closes.
 */
export function DropdownMenu({
  label,
  items,
  align = "end",
  className,
}: {
  label: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const menuId = useId();
  const triggerId = useId();
  const enabled = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.disabled);

  const focusItem = (position: number) => {
    const target = enabled[(position + enabled.length) % enabled.length];
    if (target) refs.current[target.index]?.focus();
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.findIndex(
      ({ index }) => refs.current[index] === document.activeElement,
    );
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(enabled.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const itemClass = (item: MenuItem) =>
    cn(
      "touch-target flex w-full items-center rounded-lg px-3 py-2 text-start no-underline",
      "hover:bg-cream-200 focus:bg-cream-200 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
      item.tone === "danger" ? "font-semibold text-red-700" : "text-foreground",
    );

  return (
    <div ref={root} className={cn("relative inline-block", className)}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={buttonClasses("secondary")}
      >
        {label}
        <ChevronDownIcon size={18} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute top-full z-30 mt-1 max-w-[calc(100vw-1.5rem)] min-w-48 rounded-card border border-border bg-surface p-1 shadow-lg",
            align === "end" ? "end-0" : "start-0",
          )}
        >
          {items.map((item, index) => {
            const common = {
              role: "menuitem" as const,
              tabIndex: -1,
              "aria-disabled": item.disabled || undefined,
              className: itemClass(item),
              ref: (el: HTMLElement | null) => {
                refs.current[index] = el;
              },
            };
            if (item.href && !item.disabled) {
              return (
                <Link key={item.id} href={item.href} {...common} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                {...common}
                onClick={() => {
                  if (item.disabled) return;
                  close(true);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
