"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export interface BarDatum {
  id: string;
  /** Text under the bar. */
  label: string;
  value: number;
  /** The value as it should read (already formatted for the language). */
  display: string;
  /** An unfinished period: drawn hatched instead of solid, so it differs by pattern, not only by colour. */
  provisional?: boolean;
}

const WIDTH = 600;
const HEIGHT = 240;
const TOP = 28;
const BOTTOM = 44;
const GAP = 14;

/**
 * Bar chart that never relies on the picture alone:
 *  - every bar carries its value as printed text;
 *  - the chart is one labelled image whose description lists every value, for screen readers;
 *  - a button reveals the same numbers as a real table (`table`), which people can also copy.
 * It draws what it is given: no totals, averages or comparisons are worked out here.
 */
export function BarChart({
  label,
  summary,
  data,
  table,
  showTableLabel,
  hideTableLabel,
  className,
}: {
  /** Names the chart. */
  label: string;
  /** One sentence listing the values, read out for the image. */
  summary: string;
  data: BarDatum[];
  /** The table alternative. */
  table: ReactNode;
  showTableLabel: string;
  hideTableLabel: string;
  className?: string;
}) {
  const id = useId();
  const [tableOpen, setTableOpen] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const slot = WIDTH / Math.max(1, data.length);
  const barWidth = Math.max(8, slot - GAP);

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        className="h-auto w-full"
      >
        <title id={`${id}-title`}>{label}</title>
        <desc id={`${id}-desc`}>{summary}</desc>
        <defs>
          <pattern
            id={`${id}-hatch`}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" className="fill-green-100" />
            <rect width="4" height="8" className="fill-green-700" />
          </pattern>
        </defs>
        <line
          x1="0"
          x2={WIDTH}
          y1={TOP + plotHeight}
          y2={TOP + plotHeight}
          className="stroke-charcoal-500"
          strokeWidth="1"
        />
        {data.map((datum, index) => {
          const height = datum.value === 0 ? 2 : Math.max(2, (datum.value / max) * plotHeight);
          const x = index * slot + (slot - barWidth) / 2;
          const y = TOP + plotHeight - height;
          return (
            <g key={datum.id} data-testid="bar">
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={height}
                rx="3"
                fill={datum.provisional ? `url(#${id}-hatch)` : undefined}
                className={cn(datum.provisional ? "stroke-green-700" : "fill-green-700")}
                strokeWidth={datum.provisional ? 2 : 0}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-charcoal-900 text-[14px] font-semibold"
              >
                {datum.display}
              </text>
              <text
                x={x + barWidth / 2}
                y={TOP + plotHeight + 20}
                textAnchor="middle"
                className="fill-charcoal-700 text-[13px]"
              >
                {datum.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div>
        <Button
          variant="ghost"
          aria-expanded={tableOpen}
          aria-controls={`${id}-table`}
          onClick={() => setTableOpen((open) => !open)}
        >
          {tableOpen ? hideTableLabel : showTableLabel}
        </Button>
      </div>
      <div id={`${id}-table`} hidden={!tableOpen}>
        {tableOpen ? table : null}
      </div>
    </figure>
  );
}
