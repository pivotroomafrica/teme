import { describe, expect, it } from "vitest";
import { createFormatter } from "./format";

const NOON_UTC = "2026-10-08T09:00:00Z"; // 12:00 in Addis Ababa (UTC+3)

describe("createFormatter", () => {
  it("formats numbers with Latin digits in both languages", () => {
    for (const locale of ["en", "am"] as const) {
      const f = createFormatter(locale);
      expect(f.integer(1234567)).toBe("1,234,567");
      expect(f.percent(0.25)).toMatch(/^25\s?%$/);
    }
  });

  it("shows dates in Amharic and English in the Addis Ababa time zone", () => {
    const en = createFormatter("en");
    const am = createFormatter("am");
    expect(en.date(NOON_UTC)).toContain("2026");
    expect(en.time(NOON_UTC)).toMatch(/12:00/);
    expect(am.date(NOON_UTC)).toMatch(/[ሀ-፿]/);
    expect(am.date(NOON_UTC)).not.toBe(en.date(NOON_UTC));
  });

  it("uses the Ethiopian day boundary, not the viewer's", () => {
    // 22:00 UTC is already the next day in Addis Ababa.
    expect(createFormatter("en").date("2026-10-08T22:00:00Z", "long")).toContain("9");
  });

  it("describes times relative to now", () => {
    const f = createFormatter("en");
    const now = "2026-10-08T12:00:00Z";
    expect(f.relative("2026-10-05T12:00:00Z", now)).toBe("3 days ago");
    expect(f.relative("2026-10-08T14:00:00Z", now)).toBe("in 2 hours");
    expect(createFormatter("am").relative("2026-10-05T12:00:00Z", now)).toMatch(/[ሀ-፿]/);
  });

  it("shows an em dash for an unreadable date", () => {
    expect(createFormatter("en").date("not a date")).toBe("—");
    expect(createFormatter("en").relative("nope")).toBe("—");
  });

  it("presents phone numbers the Ethiopian way", () => {
    expect(createFormatter("am").phone("+251911234567")).toBe("091 123 4567");
  });
});

describe("business time zones and calendar values", () => {
  const LATE_EVENING_UTC = "2026-10-08T21:30:00Z";

  it("shows an instant on the business's own wall clock", () => {
    expect(createFormatter("en", "Africa/Addis_Ababa").dateTime(LATE_EVENING_UTC)).toContain(
      "Oct 9, 2026",
    );
    expect(createFormatter("en", "America/Los_Angeles").dateTime(LATE_EVENING_UTC)).toContain(
      "Oct 8, 2026",
    );
  });

  it("writes a calendar date the same way in every zone", () => {
    for (const zone of ["Africa/Addis_Ababa", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      expect(createFormatter("en", zone).calendarDate("2026-10-01")).toBe("Oct 1, 2026");
    }
    expect(createFormatter("en").calendarDate("2026-02-30")).not.toBe("—"); // rolls over, never throws
    expect(createFormatter("en").calendarDate("garbage")).toBe("—");
  });

  it("names a month in either language", () => {
    expect(createFormatter("en").month("2026-10")).toBe("October 2026");
    expect(createFormatter("am").month("2026-10")).toMatch(/[ሀ-፿]/);
    expect(createFormatter("en").month("2026-1")).toBe("—");
  });
});
