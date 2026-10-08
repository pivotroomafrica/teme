"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

/**
 * Tabs following the WAI-ARIA pattern: one tab stop for the list, arrow keys / Home / End move between
 * tabs (and activate them), and the active panel itself is focusable. The tab list scrolls sideways on
 * narrow screens instead of squashing long labels.
 */
export function Tabs({
  tabs,
  label,
  defaultTab,
  value,
  onValueChange,
  className,
}: {
  tabs: TabItem[];
  /** Names the tab list for assistive technology. */
  label: string;
  defaultTab?: string;
  value?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}) {
  const base = useId();
  const [internal, setInternal] = useState(defaultTab ?? tabs.find((tab) => !tab.disabled)?.id);
  const active = value ?? internal;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((tab) => !tab.disabled);

  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
    refs.current[id]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((tab) => tab.id === active);
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(enabled[next]!.id);
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el;
              }}
              id={`${base}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.id)}
              className={cn(
                "touch-target -mb-px shrink-0 border-b-4 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60",
                selected
                  ? "border-green-700 text-green-900"
                  : "border-transparent text-charcoal-700 hover:border-cream-300",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          tabIndex={0}
          hidden={tab.id !== active}
          className="pt-4"
        >
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  );
}
