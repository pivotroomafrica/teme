import { describe, expect, it } from "vitest";
import type { Branch, Staff } from "@/lib/api/contract";
import { MOCK_ACCOUNTS } from "./fixtures";
import {
  changeRole,
  createBranch,
  inviteStaff,
  reissueInvitation,
  seedOrg,
  setBranchStatus,
  setStaffBranches,
  setStaffStatus,
  staffActivity,
  updateBranch,
  visibleBranches,
} from "./org-data";

/** The mock must refuse what the real backend refuses, or UI tests would pass for the wrong reason. */
const OWNER = "owner@mock.test" as const;
const MANAGER = "manager@mock.test" as const;
const ids = {
  owner: MOCK_ACCOUNTS[OWNER].id,
  manager: MOCK_ACCOUNTS[MANAGER].id,
  staff: MOCK_ACCOUNTS["staff@mock.test"].id,
  pending: "00000000-0000-4000-8000-0000000c0010",
  former: "00000000-0000-4000-8000-0000000c0011",
};
const body = (r: { body: unknown }) =>
  r.body as Record<string, unknown> & { error?: { code: string } };
const code = (r: { body: unknown }) => body(r).error?.code;
const person = (org: ReturnType<typeof seedOrg>, id: string) =>
  org.staff.find((s) => s.id === id) as Staff;

describe("branches", () => {
  it("creates, edits and clears fields, normalising the phone number", () => {
    const org = seedOrg();
    const created = createBranch(org, {
      nameEn: "Megenagna",
      phone: "0911 234 567",
      city: "Addis Ababa",
    });
    expect(created.status).toBe(201);
    expect(body(created)).toMatchObject({
      nameEn: "Megenagna",
      phoneE164: "+251911234567",
      status: "ACTIVE",
    });
    const id = String(body(created).id);
    const edited = updateBranch(org, id, { city: null, phone: "+251 91 123 4567" });
    expect(body(edited)).toMatchObject({ city: null, phoneE164: "+251911234567" });
  });

  it("applies the backend's limits", () => {
    const org = seedOrg();
    expect(code(createBranch(org, { nameEn: "" }))).toBe("VALIDATION_FAILED");
    expect(code(createBranch(org, { nameEn: "x".repeat(121) }))).toBe("VALIDATION_FAILED");
    expect(code(createBranch(org, { nameEn: "ok", phone: "12345" }))).toBe("VALIDATION_FAILED");
    expect(code(createBranch(org, { nameEn: "ok", addressText: "x".repeat(301) }))).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("always keeps one active branch, and (de)activating twice is harmless", () => {
    const org = seedOrg();
    const [first, second] = org.branches as [Branch, Branch];
    expect(setBranchStatus(org, first.id, "INACTIVE").status).toBe(200);
    expect(setBranchStatus(org, first.id, "INACTIVE").status).toBe(200);
    expect(code(setBranchStatus(org, second.id, "INACTIVE"))).toBe("LAST_ACTIVE_BRANCH");
    expect(setBranchStatus(org, first.id, "ACTIVE").status).toBe(200);
  });

  it("shows branch staff only their assigned active branches, and owners everything", () => {
    const org = seedOrg();
    org.branches[1]!.status = "INACTIVE";
    expect(visibleBranches(OWNER, org)).toHaveLength(2);
    expect(visibleBranches("staff@mock.test", org).map((b) => b.id)).toEqual([org.branches[0]!.id]);
  });

  it("answers 404 for a branch that does not exist", () => {
    expect(updateBranch(seedOrg(), "nope", { city: "x" }).status).toBe(404);
  });
});

describe("who may change whom", () => {
  it("lets an owner change anyone else", () => {
    const org = seedOrg();
    expect(changeRole(org, OWNER, ids.manager, { role: "STAFF" }).status).toBe(200);
  });

  it("never lets anyone change their own role, branches or status", () => {
    const org = seedOrg();
    expect(changeRole(org, OWNER, ids.owner, { role: "MANAGER" }).status).toBe(403);
    expect(setStaffBranches(org, OWNER, ids.owner, { branchIds: [] }).status).toBe(403);
    expect(setStaffStatus(org, OWNER, ids.owner, "DEACTIVATED").status).toBe(403);
    expect(changeRole(org, MANAGER, ids.manager, { role: "STAFF" }).status).toBe(403);
  });

  it("lets a manager manage branch staff only, and never grant a higher role", () => {
    const org = seedOrg();
    expect(changeRole(org, MANAGER, ids.owner, { role: "STAFF" }).status).toBe(403);
    expect(setStaffStatus(org, MANAGER, ids.owner, "DEACTIVATED").status).toBe(403);
    expect(changeRole(org, MANAGER, ids.staff, { role: "MANAGER" }).status).toBe(403);
    expect(setStaffStatus(org, MANAGER, ids.staff, "DEACTIVATED").status).toBe(200);
  });

  it("protects the last active owner from demotion and deactivation (409 LAST_OWNER)", () => {
    const org = seedOrg();
    // A second owner makes the first removable; removing them both is refused at the last one.
    const extra = body(
      inviteStaff(org, OWNER, {
        email: "second@mock.test",
        displayName: "Second Owner",
        role: "OWNER",
        branchIds: [],
      }),
    ).staff as Staff;
    person(org, extra.id).status = "ACTIVE";
    expect(setStaffStatus(org, OWNER, extra.id, "DEACTIVATED").status).toBe(200);
    // Now the only active owner is the signed-in one: another owner (this one, seen from a different actor) is not
    // available, so exercise the rule through the backend's own check on the remaining owner.
    const org2 = seedOrg();
    const second = body(
      inviteStaff(org2, OWNER, {
        email: "x@mock.test",
        displayName: "X",
        role: "OWNER",
        branchIds: [],
      }),
    ).staff as Staff;
    person(org2, second.id).status = "ACTIVE";
    person(org2, ids.owner).status = "DEACTIVATED"; // the original owner steps down
    expect(code(setStaffStatus(org2, OWNER, second.id, "DEACTIVATED"))).toBe("LAST_OWNER");
    expect(code(changeRole(org2, OWNER, second.id, { role: "MANAGER" }))).toBe("LAST_OWNER");
  });

  it("refuses to change a deactivated member", () => {
    const org = seedOrg();
    expect(code(changeRole(org, OWNER, ids.former, { role: "MANAGER" }))).toBe("CONFLICT");
    expect(
      code(setStaffBranches(org, OWNER, ids.former, { branchIds: [org.branches[0]!.id] })),
    ).toBe("CONFLICT");
  });
});

describe("branch assignment", () => {
  it("needs at least one branch for branch staff, but not for managers", () => {
    const org = seedOrg();
    expect(code(setStaffBranches(org, OWNER, ids.staff, { branchIds: [] }))).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      setStaffBranches(org, OWNER, ids.staff, { branchIds: [org.branches[0]!.id] }).status,
    ).toBe(200);
    expect(person(org, ids.staff).branchIds).toEqual([org.branches[0]!.id]);
  });

  it("only adds active branches that exist, but lets an already-assigned one stay", () => {
    const org = seedOrg();
    org.branches[1]!.status = "INACTIVE";
    const [bole, piassa] = org.branches as [Branch, Branch];
    // Pending Person works at Bole only: adding the now-inactive Piassa is refused...
    expect(
      code(setStaffBranches(org, OWNER, ids.pending, { branchIds: [bole.id, piassa.id] })),
    ).toBe("VALIDATION_FAILED");
    expect(code(setStaffBranches(org, OWNER, ids.pending, { branchIds: ["no-such-branch"] }))).toBe(
      "VALIDATION_FAILED",
    );
    // ...but Selam already works at both, so keeping Piassa is allowed.
    expect(
      setStaffBranches(org, OWNER, ids.staff, { branchIds: [bole.id, piassa.id] }).status,
    ).toBe(200);
  });
});

describe("invitations", () => {
  const branch = () => seedOrg().branches[0]!.id;

  it("creates an INVITED member and returns a one-time code", () => {
    const org = seedOrg();
    const result = inviteStaff(org, OWNER, {
      email: "New.Person@Mock.test",
      displayName: "New Person",
      role: "STAFF",
      branchIds: [org.branches[0]!.id],
    });
    expect(result.status).toBe(201);
    const { staff, invitation } = body(result) as unknown as {
      staff: Staff;
      invitation: { token: string; expiresAt: string };
    };
    expect(staff).toMatchObject({
      status: "INVITED",
      roleKey: "STAFF",
      email: "new.person@mock.test",
    });
    expect(invitation.token.length).toBeGreaterThan(16);
    expect(JSON.stringify(staff)).not.toMatch(/token|password|hash/i);
  });

  it("lets a manager invite branch staff only", () => {
    const org = seedOrg();
    expect(
      inviteStaff(org, MANAGER, {
        email: "a@mock.test",
        displayName: "A",
        role: "MANAGER",
        branchIds: [],
      }).status,
    ).toBe(403);
    expect(
      inviteStaff(org, MANAGER, {
        email: "b@mock.test",
        displayName: "B",
        role: "STAFF",
        branchIds: [org.branches[0]!.id],
      }).status,
    ).toBe(201);
  });

  it("needs a branch for branch staff and only real active ones", () => {
    const org = seedOrg();
    expect(
      code(
        inviteStaff(org, OWNER, {
          email: "a@mock.test",
          displayName: "A",
          role: "STAFF",
          branchIds: [],
        }),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      code(
        inviteStaff(org, OWNER, {
          email: "a@mock.test",
          displayName: "A",
          role: "STAFF",
          branchIds: ["x"],
        }),
      ),
    ).toBe("VALIDATION_FAILED");
  });

  it("answers the same generic 409 whether the address is on this team or elsewhere", () => {
    const org = seedOrg();
    const here = inviteStaff(org, OWNER, {
      email: "staff@mock.test",
      displayName: "A",
      role: "STAFF",
      branchIds: [branch()],
    });
    const there = inviteStaff(org, OWNER, {
      email: "someone@elsewhere.test",
      displayName: "A",
      role: "STAFF",
      branchIds: [org.branches[0]!.id],
    });
    expect(code(here)).toBe("INVITE_NOT_POSSIBLE");
    expect(body(here)).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          message: (body(there).error as unknown as { message: string }).message,
        }),
      }),
    );
    expect(code(there)).toBe("INVITE_NOT_POSSIBLE");
  });

  it("renews only invitations that are still pending", () => {
    const org = seedOrg();
    expect(reissueInvitation(org, OWNER, ids.pending).status).toBe(201);
    expect(code(reissueInvitation(org, OWNER, ids.staff))).toBe("CONFLICT");
  });

  it("does not activate somebody who has not accepted yet", () => {
    expect(code(setStaffStatus(seedOrg(), OWNER, ids.pending, "ACTIVE"))).toBe("CONFLICT");
  });
});

describe("activity", () => {
  it("pages by cursor and contains no security details", () => {
    const org = seedOrg();
    const first = staffActivity(org, ids.staff, { limit: 10 });
    const page1 = first.body as {
      events: { items: unknown[]; nextCursor: string | null };
      summary: Record<string, unknown>;
    };
    expect(page1.events.items).toHaveLength(10);
    expect(page1.events.nextCursor).toBe("10");
    const page3 = staffActivity(org, ids.staff, { limit: 10, cursor: "20" }).body as typeof page1;
    expect(page3.events.items).toHaveLength(3);
    expect(page3.events.nextCursor).toBeNull();
    expect(JSON.stringify(first.body)).not.toMatch(/ip|userAgent|password|hash|token/i);
  });
});
