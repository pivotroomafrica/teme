import { describe, expect, it } from "vitest";
import type { Staff } from "@/lib/api/contract";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator } from "@/lib/i18n/translator";
import {
  canManageMember,
  createInviteSchema,
  filterTeam,
  grantableRoles,
  isDemotion,
  isLastActiveOwner,
  isSelf,
} from "./team-rules";

const member = (over: Partial<Staff>): Staff => ({
  id: "m1",
  displayName: "Member One",
  email: "one@example.test",
  roleKey: "STAFF",
  status: "ACTIVE",
  branchIds: ["b1"],
  ...over,
});
const owner = { userId: "o1", role: "OWNER" };
const manager = { userId: "g1", role: "MANAGER" };
const staff = { userId: "s1", role: "STAFF" };

describe("which actions are offered (never authorization)", () => {
  it("offers owners actions for everyone except themselves", () => {
    expect(canManageMember(owner, member({ roleKey: "OWNER", id: "x" }), true)).toBe(true);
    expect(canManageMember(owner, member({ roleKey: "MANAGER" }), true)).toBe(true);
    expect(canManageMember(owner, member({ id: "o1", roleKey: "OWNER" }), true)).toBe(false);
  });

  it("offers managers actions for branch staff only", () => {
    expect(canManageMember(manager, member({}), true)).toBe(true);
    expect(canManageMember(manager, member({ roleKey: "MANAGER" }), true)).toBe(false);
    expect(canManageMember(manager, member({ roleKey: "OWNER" }), true)).toBe(false);
    expect(canManageMember(manager, member({ id: "g1", roleKey: "MANAGER" }), true)).toBe(false);
  });

  it("offers branch staff, and anyone without staff:manage, nothing", () => {
    expect(canManageMember(staff, member({}), true)).toBe(false);
    expect(canManageMember(owner, member({}), false)).toBe(false);
    expect(canManageMember(manager, member({}), false)).toBe(false);
  });

  it("hands out roles by what the actor may grant", () => {
    expect(grantableRoles(owner)).toEqual(["OWNER", "MANAGER", "STAFF"]);
    expect(grantableRoles(manager)).toEqual(["STAFF"]);
    expect(grantableRoles(staff)).toEqual([]);
  });

  it("recognises oneself", () => {
    expect(isSelf(owner, member({ id: "o1" }))).toBe(true);
    expect(isSelf(owner, member({ id: "other" }))).toBe(false);
  });

  it("spots the only active owner, and not when another exists or one is deactivated", () => {
    const sole = member({ id: "o1", roleKey: "OWNER" });
    expect(isLastActiveOwner([sole, member({})], sole)).toBe(true);
    expect(isLastActiveOwner([sole, member({ id: "o2", roleKey: "OWNER" })], sole)).toBe(false);
    expect(
      isLastActiveOwner(
        [sole, member({ id: "o2", roleKey: "OWNER", status: "DEACTIVATED" })],
        sole,
      ),
    ).toBe(true);
    expect(isLastActiveOwner([sole], member({ roleKey: "STAFF" }))).toBe(false);
  });

  it("calls a lower role a demotion", () => {
    expect(isDemotion("OWNER", "MANAGER")).toBe(true);
    expect(isDemotion("MANAGER", "STAFF")).toBe(true);
    expect(isDemotion("STAFF", "OWNER")).toBe(false);
    expect(isDemotion("MANAGER", "MANAGER")).toBe(false);
  });
});

describe("filterTeam", () => {
  const team = [
    member({ id: "1", displayName: "Abebe Kebede", email: "abebe@example.test" }),
    member({ id: "2", displayName: "Hana Owner", email: "hana@example.test", roleKey: "OWNER" }),
    member({ id: "3", displayName: "Old Hand", email: "old@example.test", status: "DEACTIVATED" }),
  ];
  it("matches name or email, any case", () => {
    expect(filterTeam(team, { search: "KEBEDE", role: "", status: "" }).map((s) => s.id)).toEqual([
      "1",
    ]);
    expect(filterTeam(team, { search: "hana@", role: "", status: "" }).map((s) => s.id)).toEqual([
      "2",
    ]);
  });
  it("combines search, role and status", () => {
    expect(filterTeam(team, { search: "", role: "OWNER", status: "" }).map((s) => s.id)).toEqual([
      "2",
    ]);
    expect(
      filterTeam(team, { search: "", role: "", status: "DEACTIVATED" }).map((s) => s.id),
    ).toEqual(["3"]);
    expect(filterTeam(team, { search: "hand", role: "OWNER", status: "" })).toEqual([]);
  });
  it("returns everyone for an empty filter", () => {
    expect(filterTeam(team, { search: "  ", role: "", status: "" })).toHaveLength(3);
  });
});

describe("invitation form rules", () => {
  const schema = createInviteSchema(createTranslator({ messages: en, fallback: en }));
  const valid = {
    email: "new@example.test",
    displayName: "New Person",
    role: "STAFF",
    branchIds: ["b1"],
    preferredLanguage: "EN",
  };
  const problems = (over: object) => {
    const r = schema.safeParse({ ...valid, ...over });
    const out: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) out[String(i.path[0])] ??= i.message;
    return out;
  };

  it("accepts a complete invitation", () => {
    expect(problems({})).toEqual({});
  });
  it("checks the email and the name", () => {
    expect(problems({ email: "nope" }).email).toBe(en.team.errEmail);
    expect(problems({ email: "" }).email).toBe(en.team.errEmail);
    expect(problems({ displayName: "  " }).displayName).toBe(en.team.errName);
    expect(problems({ displayName: "x".repeat(121) }).displayName).toBe(
      "Use 120 characters or fewer.",
    );
  });
  it("needs a branch for branch staff but not for owners and managers", () => {
    expect(problems({ branchIds: [] }).branchIds).toBe(en.team.branchesNeedOne);
    expect(problems({ role: "MANAGER", branchIds: [] })).toEqual({});
    expect(problems({ role: "OWNER", branchIds: [] })).toEqual({});
  });
  it("refuses an unknown role", () => {
    expect(problems({ role: "ADMIN" }).role).toBeTruthy();
  });
});
