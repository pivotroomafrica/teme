import type { Branch, MerchantRole, Staff } from "@/lib/api/contract";
import { MOCK_ACCOUNTS, MOCK_BRANCHES, type MockEmail } from "./fixtures";

/**
 * Mock branches and team. The rules follow `branches.service.ts`, `staff.service.ts` and `staff-policy`:
 *  - a business always keeps one active branch (409 LAST_ACTIVE_BRANCH);
 *  - owners manage everyone, managers manage branch staff only and cannot grant a higher role (403);
 *  - nobody changes their own role, branches or status (403);
 *  - the last active owner can be neither demoted nor deactivated (409 LAST_OWNER);
 *  - deactivated members cannot be changed (409); only members who have not accepted yet can be re-invited, and
 *    only members who have accepted can be (re)activated;
 *  - branch staff need at least one branch, and added branches must be active (400);
 *  - an email that is already in use answers one generic 409 INVITE_NOT_POSSIBLE.
 * Like programs, every mock account has its own copy so parallel tests never change each other's data.
 */
export type Reply = { status: number; body: unknown };
export interface Org {
  branches: Branch[];
  staff: Staff[];
}
export type OrgStore = Map<string, Org>;

const iso = () => new Date().toISOString();
const err = (status: number, code: string, message: string, details?: unknown): Reply => ({
  status,
  body: { error: { code, message, details, requestId: "mock-request", timestamp: iso() } },
});
const notFound = (what: string) => err(404, "NOT_FOUND", `${what} not found.`);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function seedOrg(): Org {
  const [bole, piassa] = MOCK_BRANCHES.map((b) => ({ ...b }));
  const person = (
    id: string,
    displayName: string,
    email: string,
    roleKey: MerchantRole,
    status: Staff["status"],
    branchIds: string[],
  ): Staff => ({ id, displayName, email, roleKey, status, branchIds });

  const cashiers = Array.from({ length: 12 }, (_, i) =>
    person(
      `00000000-0000-4000-8000-0000000c01${String(i).padStart(2, "0")}`,
      `Cashier ${String(i + 1).padStart(2, "0")}`,
      `cashier${i + 1}@mock.test`,
      "STAFF",
      "ACTIVE",
      [i % 2 === 0 ? bole!.id : piassa!.id],
    ),
  );

  return {
    branches: [bole!, piassa!],
    staff: [
      person(
        MOCK_ACCOUNTS["owner@mock.test"].id,
        "Hana Owner",
        "owner@mock.test",
        "OWNER",
        "ACTIVE",
        [],
      ),
      person(
        MOCK_ACCOUNTS["manager@mock.test"].id,
        "Dawit Manager",
        "manager@mock.test",
        "MANAGER",
        "ACTIVE",
        [],
      ),
      person(
        MOCK_ACCOUNTS["staff@mock.test"].id,
        "Selam Cashier",
        "staff@mock.test",
        "STAFF",
        "ACTIVE",
        [bole!.id, piassa!.id],
      ),
      person(
        "00000000-0000-4000-8000-0000000c0010",
        "Pending Person",
        "pending@mock.test",
        "STAFF",
        "INVITED",
        [bole!.id],
      ),
      person(
        "00000000-0000-4000-8000-0000000c0011",
        "Former Cashier",
        "former@mock.test",
        "STAFF",
        "DEACTIVATED",
        [piassa!.id],
      ),
      ...cashiers,
    ],
  };
}

export function orgFor(store: OrgStore, email: string): Org {
  let org = store.get(email);
  if (!org) {
    org = seedOrg();
    store.set(email, org);
  }
  return org;
}

// ───────── branches ─────────

const text = (
  field: string,
  v: unknown,
  max: number,
  opts: { min?: number; nullable?: boolean } = {},
) => {
  if (v === undefined) return undefined;
  if (v === null) return opts.nullable ? undefined : `${field} must be a string`;
  if (typeof v !== "string") return `${field} must be a string`;
  if (opts.min && v.trim().length < opts.min)
    return `${field} must be longer than or equal to ${opts.min} characters`;
  if (v.length > max) return `${field} must be shorter than or equal to ${max} characters`;
  return undefined;
};

const PHONE = /^(?:\+?251|0)?[1-579]\d{8}$/;
const normalizePhone = (raw: string): string | null => {
  const compact = raw.replace(/[\s\-.()]/g, "");
  if (!PHONE.test(compact)) return null;
  return `+251${compact.replace(/^(?:\+?251|0)/, "")}`;
};

function branchProblems(body: Record<string, unknown>, creating: boolean): string[] {
  const out = [
    text("nameEn", body.nameEn, 120, { min: creating || body.nameEn !== undefined ? 1 : 0 }),
    text("nameAm", body.nameAm, 120, { nullable: true }),
    text("addressText", body.addressText, 300, { nullable: true }),
    text("city", body.city, 80, { nullable: true }),
    text("phone", body.phone, 32, { nullable: true }),
  ];
  if (creating && typeof body.nameEn !== "string") out.push("nameEn must be a string");
  if (typeof body.phone === "string" && body.phone.trim() !== "" && !normalizePhone(body.phone)) {
    out.push("phone must be a valid Ethiopian phone number");
  }
  return out.filter((p): p is string => Boolean(p));
}

const clean = (v: unknown) =>
  typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : (v as null | undefined);

export function visibleBranches(email: MockEmail, org: Org): Branch[] {
  const scope = MOCK_ACCOUNTS[email].branchScope;
  if (scope === "ALL") return org.branches;
  return org.branches.filter(
    (b) => b.status === "ACTIVE" && Array.isArray(scope) && scope.includes(b.id),
  );
}

export function createBranch(org: Org, body: unknown): Reply {
  if (!isRecord(body))
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["body must be an object"]);
  const problems = branchProblems(body, true);
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);
  const branch: Branch = {
    id: `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, "0")}`,
    nameEn: String(body.nameEn).trim(),
    nameAm: clean(body.nameAm) ?? null,
    addressText: clean(body.addressText) ?? null,
    city: clean(body.city) ?? null,
    phoneE164:
      typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null,
    status: "ACTIVE",
  };
  org.branches.push(branch);
  return { status: 201, body: branch };
}

export function updateBranch(org: Org, id: string, body: unknown): Reply {
  const branch = org.branches.find((b) => b.id === id);
  if (!branch) return notFound("Branch");
  if (!isRecord(body))
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["body must be an object"]);
  const problems = branchProblems(body, false);
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);
  if (typeof body.nameEn === "string") branch.nameEn = body.nameEn.trim();
  if (body.nameAm !== undefined) branch.nameAm = clean(body.nameAm) ?? null;
  if (body.addressText !== undefined) branch.addressText = clean(body.addressText) ?? null;
  if (body.city !== undefined) branch.city = clean(body.city) ?? null;
  if (body.phone !== undefined) {
    branch.phoneE164 =
      typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
  }
  return { status: 200, body: branch };
}

export function setBranchStatus(org: Org, id: string, status: "ACTIVE" | "INACTIVE"): Reply {
  const branch = org.branches.find((b) => b.id === id);
  if (!branch) return notFound("Branch");
  if (branch.status === status) return { status: 200, body: branch };
  if (status === "INACTIVE" && org.branches.filter((b) => b.status === "ACTIVE").length <= 1) {
    return err(409, "LAST_ACTIVE_BRANCH", "A business must keep at least one active branch.");
  }
  branch.status = status;
  return { status: 200, body: branch };
}

// ───────── staff ─────────

const RANK: Record<MerchantRole, number> = { OWNER: 3, MANAGER: 2, STAFF: 1 };
const activeOwners = (org: Org) =>
  org.staff.filter((s) => s.roleKey === "OWNER" && s.status === "ACTIVE");

/** Mirrors `assertCanManageStaff`: who may change whom. Returns a refusal, or null when allowed. */
function refuse(
  actor: { id: string; role: MerchantRole },
  target: Staff,
  newRole?: MerchantRole,
): Reply | null {
  if (target.id === actor.id) {
    return err(403, "FORBIDDEN", "You cannot change your own role, branches or status.");
  }
  if (actor.role !== "OWNER" && RANK[target.roleKey] >= RANK[actor.role]) {
    return err(403, "FORBIDDEN", "You can only manage branch staff.");
  }
  if (actor.role !== "OWNER" && newRole && RANK[newRole] >= RANK[actor.role]) {
    return err(403, "FORBIDDEN", "You cannot grant a role that high.");
  }
  return null;
}

export const actorOf = (email: MockEmail) => ({
  id: MOCK_ACCOUNTS[email].id,
  role: MOCK_ACCOUNTS[email].role as MerchantRole,
});

const find = (org: Org, id: string) => org.staff.find((s) => s.id === id);
const invalidBranches = () => err(400, "VALIDATION_FAILED", "One or more branches are invalid.");
const token = () =>
  `inv_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const expires = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

export function inviteStaff(org: Org, email: MockEmail, body: unknown): Reply {
  const actor = actorOf(email);
  if (!isRecord(body))
    return err(400, "VALIDATION_FAILED", "Request validation failed.", ["body must be an object"]);
  const problems: string[] = [];
  if (
    typeof body.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    body.email.length > 254
  ) {
    problems.push("email must be an email");
  }
  if (
    typeof body.displayName !== "string" ||
    body.displayName.trim().length < 1 ||
    body.displayName.length > 120
  ) {
    problems.push("displayName must be between 1 and 120 characters");
  }
  const role = body.role as MerchantRole;
  if (!["OWNER", "MANAGER", "STAFF"].includes(role))
    problems.push("role must be one of the following values: OWNER, MANAGER, STAFF");
  if (!Array.isArray(body.branchIds)) problems.push("branchIds must be an array");
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);

  if (actor.role !== "OWNER" && role !== "STAFF") {
    return err(403, "FORBIDDEN", "You can only invite branch staff.");
  }
  const ids = [...new Set(body.branchIds as string[])];
  if (role === "STAFF" && ids.length === 0) {
    return err(400, "VALIDATION_FAILED", "Branch staff must be assigned to at least one branch.");
  }
  if (!ids.every((id) => org.branches.some((b) => b.id === id && b.status === "ACTIVE")))
    return invalidBranches();
  const address = String(body.email).toLowerCase();
  const taken =
    org.staff.some((s) => s.email.toLowerCase() === address) || address.endsWith("@elsewhere.test");
  if (taken) return err(409, "INVITE_NOT_POSSIBLE", "This person cannot be invited.");

  const staff: Staff = {
    id: `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, "0")}`,
    displayName: String(body.displayName).trim(),
    email: address,
    roleKey: role,
    status: "INVITED",
    branchIds: ids,
  };
  org.staff.push(staff);
  return { status: 201, body: { staff, invitation: { token: token(), expiresAt: expires() } } };
}

export function reissueInvitation(org: Org, email: MockEmail, id: string): Reply {
  const target = find(org, id);
  if (!target) return notFound("Staff member");
  const refused = refuse(actorOf(email), target);
  if (refused) return refused;
  if (target.status !== "INVITED") return err(409, "CONFLICT", "Member is not in INVITED status.");
  return { status: 201, body: { token: token(), expiresAt: expires() } };
}

export function changeRole(org: Org, email: MockEmail, id: string, body: unknown): Reply {
  const target = find(org, id);
  if (!target) return notFound("Staff member");
  const role = isRecord(body) ? (body.role as MerchantRole) : undefined;
  if (!role || !["OWNER", "MANAGER", "STAFF"].includes(role)) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "role must be one of the following values: OWNER, MANAGER, STAFF",
    ]);
  }
  if (target.status === "DEACTIVATED")
    return err(409, "CONFLICT", "Deactivated staff cannot be changed.");
  const refused = refuse(actorOf(email), target, role);
  if (refused) return refused;
  if (target.roleKey === role) return { status: 200, body: target };
  if (target.roleKey === "OWNER" && activeOwners(org).length <= 1) {
    return err(409, "LAST_OWNER", "A merchant must keep at least one active owner.");
  }
  target.roleKey = role;
  return { status: 200, body: target };
}

export function setStaffBranches(org: Org, email: MockEmail, id: string, body: unknown): Reply {
  const target = find(org, id);
  if (!target) return notFound("Staff member");
  if (!isRecord(body) || !Array.isArray(body.branchIds)) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "branchIds must be an array",
    ]);
  }
  if (target.status === "DEACTIVATED")
    return err(409, "CONFLICT", "Deactivated staff cannot be changed.");
  const refused = refuse(actorOf(email), target);
  if (refused) return refused;
  const wanted = [...new Set(body.branchIds as string[])];
  if (target.roleKey === "STAFF" && wanted.length === 0) {
    return err(400, "VALIDATION_FAILED", "Branch staff must be assigned to at least one branch.");
  }
  const additions = wanted.filter((b) => !target.branchIds.includes(b));
  if (!additions.every((b) => org.branches.some((x) => x.id === b && x.status === "ACTIVE")))
    return invalidBranches();
  target.branchIds = wanted;
  return { status: 200, body: target };
}

export function setStaffStatus(
  org: Org,
  email: MockEmail,
  id: string,
  to: "ACTIVE" | "DEACTIVATED",
): Reply {
  const target = find(org, id);
  if (!target) return notFound("Staff member");
  const refused = refuse(actorOf(email), target);
  if (refused) return refused;
  if (to === "ACTIVE") {
    if (target.status === "ACTIVE") return { status: 200, body: target };
    if (target.status === "INVITED") {
      return err(409, "CONFLICT", "Pending invitations must be accepted instead.");
    }
  } else {
    if (target.status === "DEACTIVATED") return { status: 200, body: target };
    if (target.roleKey === "OWNER" && target.status === "ACTIVE" && activeOwners(org).length <= 1) {
      return err(409, "LAST_OWNER", "A merchant must keep at least one active owner.");
    }
  }
  target.status = to;
  return { status: 200, body: target };
}

const ACTIONS = [
  "auth.login",
  "stamp.issued",
  "stamp.issued",
  "reward.redeemed",
  "scan.rejected",
  "auth.login",
];

export function staffActivity(
  org: Org,
  id: string,
  query: Record<string, unknown>,
  now = Date.now(),
): Reply {
  const target = find(org, id);
  if (!target) return notFound("Staff member");
  const limit = Math.min(Math.max(Number(query.limit ?? 10) || 10, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const total = 23;
  const events = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => {
    const n = offset + i;
    return {
      id: `00000000-0000-4000-8000-00000000e${String(n).padStart(3, "0")}`,
      action: ACTIONS[n % ACTIONS.length]!,
      targetType: null,
      targetId: null,
      branchId: target.branchIds[0] ?? null,
      occurredAt: new Date(now - (n + 1) * 37 * 60_000).toISOString(),
    };
  });
  const next = offset + events.length;
  return {
    status: 200,
    body: {
      staff: {
        id: target.id,
        displayName: target.displayName,
        roleKey: target.roleKey,
        status: target.status,
      },
      summary: {
        stampsIssued: target.roleKey === "STAFF" ? 41 : 0,
        redemptionsProcessed: target.roleKey === "STAFF" ? 6 : 0,
        reversalsPerformed: target.roleKey === "STAFF" ? 1 : 0,
        lastActiveAt: new Date(now - 37 * 60_000).toISOString(),
      },
      events: { items: events, nextCursor: next < total ? String(next) : null },
    },
  };
}
