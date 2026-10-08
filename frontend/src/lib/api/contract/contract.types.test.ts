import { describe, expectTypeOf, it } from "vitest";
import type { createCardApi } from "@/features/card/api";
import type { createEnrollmentApi } from "@/features/enrollment/api";
import type { createScannerApi } from "@/features/scanner/api";
import type { RequestBody, ResponseBody, Schemas } from "../types";
import type { EnrollmentResult, Me, ScanResult, Session, WalletLinkResult } from "./index";

/**
 * Compile-time contract checks. They do nothing at run time: `npm run typecheck` fails when the generated
 * OpenAPI types and the hand-written contract disagree, which is exactly when the backend changed.
 *
 * Known, documented difference: the backend spec types nullable text fields as `Record<string, never> | null`
 * (69 fields). The helper below removes the keys involved before comparing, so everything else must match.
 */
type WithoutNullableGap<T, K extends keyof T> = Omit<T, K>;

describe("request bodies: what services send is allowed by the OpenAPI document", () => {
  it("scanner", () => {
    type Scanner = ReturnType<typeof createScannerApi>;
    expectTypeOf<Parameters<Scanner["validate"]>[0]>().toMatchTypeOf<
      RequestBody<"/scanner/validate", "post">
    >();
    expectTypeOf<Parameters<Scanner["stamp"]>[0]>().toMatchTypeOf<
      RequestBody<"/scanner/stamps", "post">
    >();
    expectTypeOf<Parameters<Scanner["lookupRewards"]>[0]>().toMatchTypeOf<
      RequestBody<"/scanner/rewards/lookup", "post">
    >();
    expectTypeOf<Parameters<Scanner["redeem"]>[0]>().toMatchTypeOf<
      RequestBody<"/scanner/redemptions", "post">
    >();
  });

  it("enrollment", () => {
    type Enrollment = ReturnType<typeof createEnrollmentApi>;
    expectTypeOf<Parameters<Enrollment["enroll"]>[1]>().toEqualTypeOf<
      RequestBody<"/join/{joinReference}/enroll", "post">
    >();
  });

  it("card", () => {
    type Card = ReturnType<typeof createCardApi>;
    expectTypeOf<Parameters<Card["createWalletLink"]>[1]>().toEqualTypeOf<
      Schemas["WalletLinkDto"]["provider"]
    >();
  });
});

describe("responses: the hand-written contract agrees with the generated types", () => {
  it("session", () => {
    type Generated = Schemas["SessionDto"];
    expectTypeOf<Omit<Session, "user">>().toEqualTypeOf<Omit<Generated, "user">>();
    expectTypeOf<WithoutNullableGap<Session["user"], "merchantId">>().toEqualTypeOf<
      WithoutNullableGap<Generated["user"], "merchantId">
    >();
  });

  it("me", () => {
    type Generated = Schemas["MeDto"];
    expectTypeOf<Pick<Me, "userId" | "kind" | "role" | "permissions">>().toEqualTypeOf<
      Pick<Generated, "userId" | "kind" | "role" | "permissions">
    >();
  });

  it("wallet link", () => {
    type Generated = Schemas["WalletLinkResultDto"];
    expectTypeOf<Pick<WalletLinkResult, "provider" | "kind">>().toEqualTypeOf<
      Pick<Generated, "provider" | "kind">
    >();
  });

  it("scan result: the outcome and reason vocabularies are the generated ones", () => {
    type Generated = Schemas["ScanResultDto"];
    expectTypeOf<ScanResult["outcome"]>().toEqualTypeOf<Generated["outcome"]>();
    expectTypeOf<NonNullable<ScanResult["reason"]>>().toEqualTypeOf<
      NonNullable<Exclude<Generated["reason"], Record<string, never>>>
    >();
  });

  it("enrollment status", () => {
    expectTypeOf<EnrollmentResult["status"]>().toEqualTypeOf<
      Schemas["EnrollmentResultDto"]["status"]
    >();
  });

  it("operations the spec documents without a success body have no generated response type", () => {
    // If this ever becomes a real type, the matching schema in contract/index.ts is no longer needed.
    expectTypeOf<ResponseBody<"/card/web", "post">>().toBeNever();
  });
});
