import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useFormat, useT } from "./client";
import { en } from "./messages/en";

function Probe() {
  const t = useT();
  const format = useFormat();
  return (
    <>
      <p data-testid="known">{t("common.retry")}</p>
      <p data-testid="missing">{t("confirm.yes")}</p>
      <p data-testid="phone">{format.phone("0911234567", "international")}</p>
      <p data-testid="locale">{format.locale}</p>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("I18nProvider", () => {
  it("uses the active language and falls back to English for keys it does not have", () => {
    render(
      <I18nProvider locale="am" messages={{ common: { retry: "እንደገና ሞክር" } }}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("known")).toHaveTextContent("እንደገና ሞክር");
    expect(screen.getByTestId("missing")).toHaveTextContent(en.confirm.yes);
    expect(screen.getByTestId("locale")).toHaveTextContent("am");
    expect(screen.getByTestId("phone")).toHaveTextContent("+251 91 123 4567");
  });

  it("warns about each missing key while developing, and only then", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    render(
      <I18nProvider locale="am" messages={{}}>
        <Probe />
      </I18nProvider>,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Missing "am" translation'));
    vi.unstubAllEnvs();
  });
});
