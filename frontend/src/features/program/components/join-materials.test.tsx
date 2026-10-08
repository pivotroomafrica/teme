import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qrSvg } from "@/features/card/qr";
import { I18nProvider } from "@/lib/i18n/client";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import { seedPrograms } from "@/mocks/program-data";
import { joinUrl, type PosterLanguage } from "../qr-links";
import { JoinMaterials, type JoinCode } from "./join-materials";

const ORIGIN = "https://card.example.org";
const MERCHANT = { nameEn: "Sample Cafe", nameAm: "ናሙና ቡና ቤት" };
const POSTER = { en: en.poster, am: am.poster } as never;
const program = seedPrograms()[0]!;

async function codes(): Promise<Record<PosterLanguage, JoinCode>> {
  const make = async (language: PosterLanguage) => {
    const url = joinUrl(ORIGIN, "sample-cafe", language);
    return { url, svg: await qrSvg(url) };
  };
  return { en: await make("en"), am: await make("am"), both: await make("both") };
}

async function show(options: { live?: boolean; withCodes?: boolean } = {}) {
  const user = userEvent.setup();
  render(
    <I18nProvider locale="en" messages={en}>
      <JoinMaterials
        codes={options.withCodes === false ? null : await codes()}
        merchant={MERCHANT}
        program={program}
        programIsLive={options.live ?? true}
        posterMessages={POSTER}
      />
    </I18nProvider>,
  );
  return user;
}

const download = vi.fn();
let createdUrls: Blob[] = [];

beforeEach(() => {
  download.mockReset();
  createdUrls = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        createdUrls.push(blob);
        return "blob:test";
      },
      revokeObjectURL: () => undefined,
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    download(this.download);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("JoinMaterials", () => {
  it("shows the join link made from the public reference, in the chosen language", async () => {
    const user = await show();
    expect(screen.getByTestId("join-link")).toHaveTextContent(
      "https://card.example.org/join/sample-cafe",
    );
    await user.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByTestId("join-link")).toHaveTextContent(
      "https://card.example.org/en/join/sample-cafe",
    );
    await user.click(screen.getByRole("radio", { name: "Amharic" }));
    expect(screen.getByTestId("join-link")).toHaveTextContent(
      "https://card.example.org/am/join/sample-cafe",
    );
  });

  it("never puts an internal identifier in the link or the poster", async () => {
    await show();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(program.id);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("offers English only, Amharic only, or both on the poster", async () => {
    const user = await show();
    const poster = () => screen.getByTestId("poster");

    await user.click(screen.getByRole("radio", { name: "English" }));
    expect(poster()).toHaveAttribute("data-language", "en");
    expect(within(poster()).getByText("Join our loyalty program")).toBeInTheDocument();
    expect(within(poster()).queryByText("ወደ የታማኝነት ፕሮግራማችን ይቀላቀሉ")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Amharic" }));
    expect(within(poster()).getByText("ወደ የታማኝነት ፕሮግራማችን ይቀላቀሉ")).toBeInTheDocument();
    expect(within(poster()).queryByText("Join our loyalty program")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /^English and Amharic/ }));
    expect(within(poster()).getByText("Join our loyalty program")).toBeInTheDocument();
    expect(within(poster()).getByText("ወደ የታማኝነት ፕሮግራማችን ይቀላቀሉ")).toBeInTheDocument();
  });

  it("shows the business's own words on the poster, as written", async () => {
    const user = await show();
    await user.click(screen.getByRole("radio", { name: "Amharic" }));
    const poster = screen.getByTestId("poster");
    expect(within(poster).getAllByText(/ናሙና ቡና ቤት/).length).toBeGreaterThan(0);
    expect(within(poster).getByText(/ነጻ ቡና/)).toBeInTheDocument();
  });

  it("draws a QR code whose picture matches the link and states the link in text", async () => {
    await show();
    const expected = (await codes()).both;
    // Compare as the browser sees it: the same markup parsed the same way.
    const reference = document.createElement("div");
    reference.innerHTML = expected.svg;
    expect(screen.getByTestId("poster-qr").innerHTML).toBe(reference.innerHTML);
    expect(screen.getByTestId("poster-url")).toHaveTextContent(expected.url);
  });

  it("downloads the code as SVG and PNG with names that carry no identifier", async () => {
    const user = await show();
    await user.click(screen.getByRole("radio", { name: "Amharic" }));
    await user.click(screen.getByRole("button", { name: "Download QR (SVG)" }));
    expect(download).toHaveBeenCalledWith("join-qr-am.svg");
    expect(createdUrls[0]!.type).toBe("image/svg+xml");
    expect(await createdUrls[0]!.text()).toBe((await codes()).am.svg);
  });

  it("opens the browser's print dialog for the poster, with a hint about saving as PDF", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const user = await show();
    await user.click(screen.getByRole("button", { name: "Print poster or save as PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/choose Save as PDF/)).toBeInTheDocument();
  });

  it("says plainly that one code per branch is not available, and that the logo cannot be added", async () => {
    await show();
    expect(screen.getByTestId("branch-qr-unavailable")).toHaveTextContent(
      /Not available: the join link is the same for every branch/,
    );
    expect(screen.getByText(/logo cannot be added to posters yet/)).toBeInTheDocument();
  });

  it("warns that customers cannot join until a program is active", async () => {
    await show({ live: false });
    expect(
      screen.getByText(/Customers can only join while a program is active/),
    ).toBeInTheDocument();
  });

  it("says no code can be made when the backend gave no join reference", async () => {
    await show({ withCodes: false });
    expect(screen.getByText(/join link is not available yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("poster")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  });
});
