import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart";

const data = [
  { id: "a", label: "May", value: 10, display: "10" },
  { id: "b", label: "Jun", value: 0, display: "0" },
  { id: "c", label: "Jul", value: 25, display: "25", provisional: true },
];

function show() {
  render(
    <BarChart
      label="Customers by month"
      summary="May: 10; June: 0; July (so far): 25"
      data={data}
      showTableLabel="Show as a table"
      hideTableLabel="Hide the table"
      table={
        <table aria-label="same numbers">
          <tbody>
            <tr>
              <td>May</td>
              <td>10</td>
            </tr>
          </tbody>
        </table>
      }
    />,
  );
}

describe("BarChart", () => {
  it("is one named image with every value in its description", () => {
    show();
    const chart = screen.getByRole("img", { name: "Customers by month" });
    expect(chart).toHaveAccessibleDescription("May: 10; June: 0; July (so far): 25");
  });

  it("prints every value on its bar, including zero", () => {
    show();
    const bars = screen.getAllByTestId("bar");
    expect(bars.map((b) => b.textContent)).toEqual(["10May", "0Jun", "25Jul"]);
  });

  it("keeps a zero visible as a flat bar, not nothing", () => {
    show();
    const rects = screen.getAllByTestId("bar").map((b) => b.querySelector("rect")!);
    expect(Number(rects[1]!.getAttribute("height"))).toBeGreaterThan(0);
    expect(Number(rects[2]!.getAttribute("height"))).toBeGreaterThan(
      Number(rects[0]!.getAttribute("height")),
    );
  });

  it("marks an unfinished period by pattern, not only colour", () => {
    show();
    const [done, , partial] = screen.getAllByTestId("bar").map((b) => b.querySelector("rect")!);
    expect(done!.getAttribute("fill")).toBeNull();
    expect(partial!.getAttribute("fill")).toMatch(/^url\(#.*hatch\)$/);
  });

  it("reveals the table alternative on request and hides it again", async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Show as a table" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(
      within(screen.getByRole("table", { name: "same numbers" })).getByText("10"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide the table" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Hide the table" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("copes with no data and with all zeros", () => {
    const { container } = render(
      <BarChart
        label="x"
        summary="none"
        data={[]}
        showTableLabel="s"
        hideTableLabel="h"
        table={null}
      />,
    );
    expect(container.querySelectorAll("[data-testid=bar]").length).toBe(0);
  });
});
