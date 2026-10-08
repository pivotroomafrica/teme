import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  tone = "default",
  ...props
}: ComponentProps<"section"> & { tone?: "default" | "highlight" }) {
  return (
    <section
      className={cn(
        "rounded-card border bg-surface p-5 shadow-sm",
        tone === "highlight" ? "border-gold-500 ring-2 ring-gold-300" : "border-border",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  headingLevel = 2,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  id?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading id={id} className="text-lg font-semibold text-green-900">
          {title}
        </Heading>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
