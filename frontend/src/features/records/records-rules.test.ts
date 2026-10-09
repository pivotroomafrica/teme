import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/errors/api-error";
import { createTranslator } from "@/lib/i18n/translator";
import { en } from "@/lib/i18n/messages/en";
import {
  displayPhone,
  explainReversalError,
  maskPhone,
  rangeProblem,
  reasonProblem,
  safeMetadata,
} from "./records-rules";

const t = createTranslator({ messages: en, fallback: en });
const failure = (kind: ApiError["kind"], code: string, status: number) =>
  new ApiError({ kind, code, status, message: "backend english text" });

describe("safeMetadata", () => {
  it("never returns secrets, tokens, passwords, wallet credentials or network details", () => {
    const rows = safeMetadata({
      method: "password",
      token: "T",
      accessToken: "A",
      refreshToken: "R",
      password: "P",
      newPassword: "N",
      passwordHash: "H",
      walletCredential: "W",
      apiKey: "K",
      client_secret: "S",
      authorization: "Bearer x",
      cookie: "c",
      ip: "10.0.0.1",
      userAgent: "UA",
      deviceId: "D",
      sessionId: "SID",
      privateKey: "PK",
    });
    expect(rows.map((r) => r.key)).toEqual(["method"]);
    expect(JSON.stringify(rows)).not.toMatch(/Bearer|10\.0\.0\.1|"T"|"P"|"W"/);
  });

  it("labels keys in words, flattens arrays, drops nested objects and empty values, and shortens long text", () => {
    const rows = safeMetadata({
      changedFields: ["city", "phone"],
      reversedEventId: "e-1",
      nested: { password: "x" },
      empty: "",
      nothing: null,
      note: "y".repeat(300),
      count: 3,
      flag: false,
    });
    expect(rows.find((r) => r.key === "changedFields")).toMatchObject({
      label: "Changed fields",
      value: "city, phone",
    });
    expect(rows.find((r) => r.key === "reversedEventId")?.label).toBe("Reversed event id");
    expect(rows.some((r) => r.key === "nested" || r.key === "empty" || r.key === "nothing")).toBe(
      false,
    );
    expect(rows.find((r) => r.key === "note")!.value.length).toBeLessThanOrEqual(201);
    expect(rows.find((r) => r.key === "count")?.value).toBe("3");
    expect(rows.find((r) => r.key === "flag")?.value).toBe("false");
  });

  it("copes with no metadata", () => {
    expect(safeMetadata(null)).toEqual([]);
    expect(safeMetadata(undefined)).toEqual([]);
  });
});

describe("phone masking", () => {
  it("hides the middle digits", () => {
    expect(maskPhone("+251911000111")).toBe("+2519*****111");
    expect(maskPhone("1234")).toBe("****");
  });

  it("masks again for people without full access, even if the backend did not", () => {
    const unmasked = { phone: "+251911000111", phoneMasked: false };
    expect(displayPhone(unmasked, false)).toBe("+2519*****111");
    expect(displayPhone(unmasked, true)).toBe("+251911000111");
    expect(displayPhone({ phone: "+2519*****111", phoneMasked: true }, false)).toBe(
      "+2519*****111",
    );
    expect(displayPhone({ phone: null, phoneMasked: true }, true)).toBeNull();
  });
});

describe("reason and dates", () => {
  it("requires 3 to 500 characters after trimming", () => {
    expect(reasonProblem("  ab  ")).toBe("short");
    expect(reasonProblem("abc")).toBeNull();
    expect(reasonProblem("x".repeat(500))).toBeNull();
    expect(reasonProblem("x".repeat(501))).toBe("long");
  });

  it("accepts equal days and open ends, rejects a start after the end", () => {
    expect(rangeProblem("2026-10-02", "2026-10-01")).toBe(true);
    expect(rangeProblem("2026-10-01", "2026-10-01")).toBe(false);
    expect(rangeProblem("", "2026-10-01")).toBe(false);
  });
});

describe("explainReversalError", () => {
  it("explains the backend's coded refusals in words, never with its English text", () => {
    expect(explainReversalError(failure("conflict", "ALREADY_REVERSED", 409), t)).toBe(
      en.records.errAlreadyReversed,
    );
    expect(explainReversalError(failure("conflict", "REWARD_ALREADY_REDEEMED", 409), t)).toBe(
      en.records.errRewardRedeemed,
    );
    expect(explainReversalError(failure("forbidden", "FORBIDDEN", 403), t)).toBe(
      en.records.errReverseForbidden,
    );
    expect(explainReversalError(failure("validation", "VALIDATION_FAILED", 400), t)).toBe(
      en.records.errReasonInvalid,
    );
    expect(explainReversalError(failure("not_found", "NOT_FOUND", 404), t)).not.toContain(
      "backend english",
    );
  });
});
