"use client";

import type { ReactNode } from "react";
import { RowHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui";

export interface Column<T> {
  id: string;
  header: string;
  /** The cell's content on wide screens. */
  cell: (item: T) => ReactNode;
  /** Marks the column that names the row (rendered as a row header). */
  rowHeader?: boolean;
}

/**
 * One list, two layouts. From tablet width up it is a real table (column and row headers, keyboard-scrollable).
 * On a phone a table would force sideways scrolling, so the same rows become a list of cards in which every value
 * keeps its label. Only one layout is on screen at a time (the other is hidden from everyone, including screen
 * readers), so nothing is announced twice.
 */
export function ResponsiveTable<T>({
  label,
  items,
  rowKey,
  columns,
  card,
}: {
  label: string;
  items: readonly T[];
  rowKey: (item: T) => string;
  columns: Column<T>[];
  /** The card for one row on a phone: usually a name, its details with labels, and the row's actions. */
  card: (item: T) => ReactNode;
}) {
  return (
    <>
      <div className="hidden md:block">
        <Table label={label}>
          <THead>
            <TR>
              {columns.map((column) => (
                <TH key={column.id}>{column.header}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {items.map((item) => (
              <TR key={rowKey(item)}>
                {columns.map((column) =>
                  column.rowHeader ? (
                    <RowHeader key={column.id}>{column.cell(item)}</RowHeader>
                  ) : (
                    <TD key={column.id}>{column.cell(item)}</TD>
                  ),
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <ul aria-label={label} className="flex flex-col gap-3 md:hidden" data-testid="card-list">
        {items.map((item) => (
          <li key={rowKey(item)} className="rounded-card border border-border bg-surface p-4">
            {card(item)}
          </li>
        ))}
      </ul>
    </>
  );
}
