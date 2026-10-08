import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@tests/helpers/axe";
import { renderUi } from "@tests/helpers/render";
import { DropdownMenu } from "./dropdown-menu";
import { Pagination } from "./pagination";
import { SearchField } from "./search-field";
import { RowHeader, TBody, TD, TH, THead, TR, Table } from "./table";
import { Tabs } from "./tabs";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const tabs = [
  { id: "a", label: "Overview", content: <p>Overview panel</p> },
  { id: "b", label: "Off", content: <p>Never</p>, disabled: true },
  { id: "c", label: "Branches", content: <p>Branches panel</p> },
];

describe("Tabs", () => {
  it("wires tabs to panels and shows only the active one", () => {
    renderUi(<Tabs label="Sections" tabs={tabs} />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
    const first = screen.getByRole("tab", { name: "Overview" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toHaveTextContent("Overview panel");
    expect(screen.getByRole("tab", { name: "Branches" })).toHaveAttribute("aria-selected", "false");
  });

  it("uses a roving tab stop and arrow, Home and End keys, skipping disabled tabs", async () => {
    renderUi(<Tabs label="Sections" tabs={tabs} />);
    await userEvent.tab();
    const overview = screen.getByRole("tab", { name: "Overview" });
    const branches = screen.getByRole("tab", { name: "Branches" });
    expect(overview).toHaveFocus();
    expect(branches).toHaveAttribute("tabindex", "-1");
    await userEvent.keyboard("{ArrowRight}");
    expect(branches).toHaveFocus();
    expect(branches).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Branches" })).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    expect(overview).toHaveFocus(); // wraps, never lands on the disabled tab
    await userEvent.keyboard("{End}");
    expect(branches).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(overview).toHaveFocus();
  });

  it("can be controlled", async () => {
    const onChange = vi.fn();
    renderUi(<Tabs label="Sections" tabs={tabs} value="a" onValueChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Branches" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("DropdownMenu", () => {
  const items = [
    { id: "edit", label: "Edit", onSelect: vi.fn() },
    { id: "off", label: "Unavailable", disabled: true },
    { id: "docs", label: "Docs", href: "/docs" },
    { id: "del", label: "Delete", tone: "danger" as const, onSelect: vi.fn() },
  ];

  it("opens with the keyboard, focuses the first item and exposes menu semantics", async () => {
    renderUi(<DropdownMenu label="Actions" items={items} />);
    const trigger = screen.getByRole("button", { name: /Actions/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Unavailable" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("moves with arrows (skipping disabled items), wraps, and closes on Escape returning focus", async () => {
    renderUi(<DropdownMenu label="Actions" items={items} />);
    await userEvent.click(screen.getByRole("button", { name: /Actions/ }));
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Docs" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: /Actions/ })).toHaveFocus();
  });

  it("runs the chosen action once and closes", async () => {
    const onSelect = vi.fn();
    renderUi(<DropdownMenu label="Actions" items={[{ id: "x", label: "Run", onSelect }]} />);
    await userEvent.click(screen.getByRole("button", { name: /Actions/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Run" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when clicking elsewhere", async () => {
    renderUi(
      <>
        <DropdownMenu label="Actions" items={items} />
        <p>Outside</p>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Actions/ }));
    await userEvent.click(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("has no accessibility violations when open", async () => {
    const { container } = renderUi(<DropdownMenu label="Actions" items={items} />);
    await userEvent.click(screen.getByRole("button", { name: /Actions/ }));
    await expectNoA11yViolations(container);
  });
});

describe("Pagination", () => {
  it("disables unavailable directions and reports moves", async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    renderUi(
      <Pagination
        hasPrevious={false}
        hasNext
        from={1}
        to={25}
        total={60}
        onNext={onNext}
        onPrevious={onPrevious}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1–25 of 60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("locks both buttons while loading and translates", () => {
    renderUi(
      <Pagination hasPrevious hasNext loading onNext={vi.fn()} onPrevious={vi.fn()} />,
      "am",
    );
    expect(screen.getByRole("button", { name: "ቀዳሚ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ቀጣይ" })).toBeDisabled();
  });
});

describe("SearchField", () => {
  it("is a named search landmark that searches on submit with trimmed text", async () => {
    const onSearch = vi.fn();
    renderUi(<SearchField label="Search customers" onSearch={onSearch} />);
    expect(screen.getByRole("search", { name: "Search customers" })).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search customers" }),
      "  abebe  {Enter}",
    );
    expect(onSearch).toHaveBeenCalledWith("abebe");
  });

  it("clears and refocuses", async () => {
    const onSearch = vi.fn();
    renderUi(<SearchField label="Search" onSearch={onSearch} defaultValue="hana" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onSearch).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});

describe("Table", () => {
  it("is a focusable named region with column and row headers", () => {
    renderUi(
      <Table label="Customers">
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <RowHeader>Abebe</RowHeader>
            <TD>Active</TD>
          </TR>
        </TBody>
      </Table>,
    );
    const region = screen.getByRole("region", { name: "Customers" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table", { name: "Customers" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByRole("rowheader", { name: "Abebe" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderUi(
      <Table label="Customers">
        <THead>
          <TR>
            <TH>Name</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <RowHeader>Abebe</RowHeader>
          </TR>
        </TBody>
      </Table>,
    );
    await expectNoA11yViolations(container);
  });
});
