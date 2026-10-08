import { describe, expect, it } from "vitest";
import {
  MAX_RANGE_DAYS,
  addDays,
  checkRange,
  daysInclusive,
  isCalendarDate,
  matchPreset,
  paramsFor,
  presetRange,
  rangeFromParams,
  todayIn,
} from "./range";

const params = (query: string) => new URLSearchParams(query);

describe("calendar arithmetic", () => {
  it("recognises only real dates", () => {
    expect(isCalendarDate("2026-10-08")).toBe(true);
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "26-10-08",
      "2026-10-8",
      "",
      null,
      undefined,
      "2026-10-08T00:00",
    ]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("counts both ends of a range", () => {
    expect(daysInclusive({ from: "2026-10-01", to: "2026-10-01" })).toBe(1);
    expect(daysInclusive({ from: "2026-10-01", to: "2026-10-30" })).toBe(30);
  });
});

describe("todayIn", () => {
  it("reads the date on the business's own wall clock, not the viewer's", () => {
    const lateEveningUtc = new Date("2026-10-08T22:30:00Z"); // already the 9th in Addis Ababa (UTC+3)
    expect(todayIn("Africa/Addis_Ababa", lateEveningUtc)).toBe("2026-10-09");
    expect(todayIn("UTC", lateEveningUtc)).toBe("2026-10-08");
    expect(todayIn("America/Los_Angeles", lateEveningUtc)).toBe("2026-10-08");
  });

  it("does not break on an unknown zone", () => {
    expect(todayIn("Not/AZone", new Date("2026-10-08T12:00:00Z"))).toBe("2026-10-08");
  });
});

describe("presets", () => {
  const today = "2026-10-08";
  it("end today and cover the stated days", () => {
    expect(presetRange("last7", today)).toEqual({ from: "2026-10-02", to: "2026-10-08" });
    expect(presetRange("last30", today)).toEqual({ from: "2026-09-09", to: "2026-10-08" });
    expect(daysInclusive(presetRange("last90", today))).toBe(90);
  });

  it("knows this month and last month, including a short February", () => {
    expect(presetRange("thisMonth", today)).toEqual({ from: "2026-10-01", to: "2026-10-08" });
    expect(presetRange("lastMonth", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("lastMonth", "2026-03-15")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(presetRange("lastMonth", "2026-01-05")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("every preset is within the backend's limit", () => {
    for (const p of ["last7", "last30", "last90", "thisMonth", "lastMonth"] as const) {
      expect(checkRange(presetRange(p, today).from, presetRange(p, today).to)).toBeNull();
    }
  });

  it("recognises which preset a range is", () => {
    expect(matchPreset({ from: "2026-09-09", to: "2026-10-08" }, today)).toBe("last30");
    expect(matchPreset({ from: "2026-09-10", to: "2026-10-08" }, today)).toBeNull();
  });
});

describe("checkRange", () => {
  it("accepts a normal range, one day, and exactly the maximum", () => {
    expect(checkRange("2026-10-01", "2026-10-08")).toBeNull();
    expect(checkRange("2026-10-01", "2026-10-01")).toBeNull();
    expect(checkRange("2025-10-08", "2026-10-08")).toBeNull(); // 366 days inclusive
    expect(daysInclusive({ from: "2025-10-08", to: "2026-10-08" })).toBe(MAX_RANGE_DAYS);
  });

  it("explains what is wrong, like the backend will", () => {
    expect(checkRange("2026-10-09", "2026-10-08")).toBe("order");
    expect(checkRange("2025-10-07", "2026-10-08")).toBe("tooLong");
    expect(checkRange("2026-02-30", "2026-03-01")).toBe("invalid");
    expect(checkRange("", "2026-03-01")).toBe("invalid");
  });
});

describe("the page address", () => {
  const today = "2026-10-08";

  it("defaults to the last 30 days", () => {
    expect(rangeFromParams(params(""), today)).toEqual({
      preset: "last30",
      range: { from: "2026-09-09", to: "2026-10-08" },
    });
  });

  it("reads a named period or two dates", () => {
    expect(rangeFromParams(params("range=last7"), today).range.from).toBe("2026-10-02");
    expect(rangeFromParams(params("from=2026-08-01&to=2026-08-31"), today)).toEqual({
      preset: "custom",
      range: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("falls back to the default for anything it cannot trust", () => {
    for (const bad of [
      "range=forever",
      "from=2026-08-31&to=2026-08-01",
      "from=x&to=y",
      "from=2026-08-01",
      "from=2024-01-01&to=2026-08-01",
    ]) {
      expect(rangeFromParams(params(bad), today).preset).toBe("last30");
    }
  });

  it("builds an address, leaving out the default", () => {
    expect(paramsFor("last30")).toBe("");
    expect(paramsFor("last7")).toBe("?range=last7");
    expect(paramsFor({ from: "2026-08-01", to: "2026-08-31" })).toBe(
      "?from=2026-08-01&to=2026-08-31",
    );
  });
});
