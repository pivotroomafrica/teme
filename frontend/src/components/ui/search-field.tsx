"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { Button } from "./button";
import { CloseIcon, SearchIcon } from "./icons";
import { controlClasses } from "./form-field";

/**
 * Search box (a `search` landmark). Submitting runs the search; there is no search-as-you-type, which keeps
 * requests low on slow connections and avoids announcing results on every keystroke.
 */
export function SearchField({
  label,
  placeholder,
  defaultValue = "",
  onSearch,
  className,
}: {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSearch: (query: string) => void;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  return (
    <form
      role="search"
      aria-label={label}
      className={cn("flex gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value.trim());
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-charcoal-500" />
        <input
          ref={input}
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => setValue(event.target.value)}
          className={cn(controlClasses, "ps-10", value && "pe-11")}
        />
        {value ? (
          <button
            type="button"
            aria-label={t("ui.clearSearch")}
            onClick={() => {
              setValue("");
              onSearch("");
              input.current?.focus();
            }}
            className="touch-target absolute end-0 top-0 inline-flex items-center justify-center rounded-control text-charcoal-700 hover:bg-cream-200"
          >
            <CloseIcon size={18} />
          </button>
        ) : null}
      </div>
      <Button type="submit">{t("ui.search")}</Button>
    </form>
  );
}
