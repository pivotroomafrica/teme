"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { ExternalIcon } from "./icons";

export interface TextLinkProps extends ComponentProps<typeof Link> {
  /** Opens in a new tab with safe defaults and an announced hint. */
  external?: boolean;
}

/** Inline link. Always underlined (links must not rely on colour alone). */
export function TextLink({ external = false, className, children, ...props }: TextLinkProps) {
  const t = useT();
  return (
    <Link
      className={cn(
        "inline-flex items-center gap-1 font-medium underline hover:text-green-900",
        className,
      )}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {children}
      {external ? (
        <>
          <ExternalIcon size={16} />
          <span className="sr-only"> ({t("ui.externalLink")})</span>
        </>
      ) : null}
    </Link>
  );
}
