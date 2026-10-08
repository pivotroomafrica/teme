import type { Program } from "@/lib/api/contract";
import { STAMP_ICONS } from "@/lib/api/contract";

/**
 * Mock loyalty programs. They follow the backend rules in `programs.controller.ts` and `programs.service.ts`:
 * the same limits, the same coded 409s, the lifecycle DRAFT -> ACTIVE <-> PAUSED and any state -> ARCHIVED, one
 * default ACTIVE program, and a stamp requirement that locks once customers have joined.
 *
 * Every mock account has its own programs, so end-to-end tests running side by side on one server never change
 * each other's data. (The real backend has one set per business.)
 */
export type Reply = { status: number; body: unknown };
export type ProgramStore = Map<string, Program[]>;

const HEX = /^#[0-9A-Fa-f]{6}$/;
const iso = () => new Date().toISOString();

export function seedPrograms(): Program[] {
  return [
    {
      id: "00000000-0000-4000-8000-0000000d0001",
      status: "ACTIVE",
      isDefault: true,
      nameEn: "Coffee Card",
      nameAm: "የቡና ካርድ",
      termsEn: "One stamp per visit. The 8th stamp earns a free coffee.",
      termsAm: "በአንድ ጉብኝት አንድ ስታምፕ። 8ኛው ስታምፕ ነጻ ቡና ያስገኛል።",
      stampsRequired: 8,
      cooldownMinutes: 120,
      brandColor: "#1B5E3A",
      cardDisplay: {
        title: "Coffee card",
        subtitle: "Sample Cafe",
        stampIcon: "coffee",
        showProgressText: true,
      },
      reward: {
        id: "00000000-0000-4000-8000-0000000d1001",
        nameEn: "Free coffee",
        nameAm: "ነጻ ቡና",
        descriptionEn: "Any coffee from the menu.",
        descriptionAm: "ከዝርዝሩ ማንኛውም ቡና።",
        validForDays: null,
      },
      memberCount: 12,
      stampsRequiredLocked: true,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    },
  ];
}

export function programsFor(store: ProgramStore, email: string): Program[] {
  let list = store.get(email);
  if (!list) {
    list = seedPrograms();
    store.set(email, list);
  }
  return list;
}

const bad = (details: string[]): Reply => ({
  status: 400,
  body: error("VALIDATION_FAILED", "Request validation failed.", details),
});
const conflict = (code: string, message: string): Reply => ({
  status: 409,
  body: error(code, message),
});
const notFound = (): Reply => ({ status: 404, body: error("NOT_FOUND", "Program not found.") });

function error(code: string, message: string, details?: unknown) {
  return { error: { code, message, details, requestId: "mock-request", timestamp: iso() } };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Text fields: a string within the limit, or (when allowed) null. Returns a problem or undefined. */
function textProblem(
  field: string,
  value: unknown,
  max: number,
  opts: { min?: number; nullable?: boolean } = {},
) {
  if (value === undefined) return undefined;
  if (value === null) return opts.nullable ? undefined : `${field} must be a string`;
  if (typeof value !== "string") return `${field} must be a string`;
  if (opts.min && value.trim().length < opts.min)
    return `${field} must be longer than or equal to ${opts.min} characters`;
  if (value.length > max) return `${field} must be shorter than or equal to ${max} characters`;
  return undefined;
}

function intProblem(field: string, value: unknown, min: number, max: number, nullable = false) {
  if (value === undefined) return undefined;
  if (value === null) return nullable ? undefined : `${field} must be an integer number`;
  if (!Number.isInteger(value)) return `${field} must be an integer number`;
  const n = value as number;
  if (n < min) return `${field} must not be less than ${min}`;
  if (n > max) return `${field} must not be greater than ${max}`;
  return undefined;
}

const clean = (v: unknown) =>
  typeof v === "string" ? (v.trim() === "" ? null : v) : (v as null | undefined);

function validateFields(body: Record<string, unknown>, creating: boolean): string[] {
  const problems: Array<string | undefined> = [
    textProblem("nameEn", body.nameEn, 120, { min: creating || body.nameEn !== undefined ? 1 : 0 }),
    textProblem("nameAm", body.nameAm, 120, { nullable: true }),
    textProblem("termsEn", body.termsEn, 2000, { nullable: true }),
    textProblem("termsAm", body.termsAm, 2000, { nullable: true }),
    intProblem("stampsRequired", body.stampsRequired, 1, 1000),
    intProblem("cooldownMinutes", body.cooldownMinutes, 0, 10080),
  ];
  if (creating && typeof body.nameEn !== "string") problems.push("nameEn must be a string");
  if (
    body.brandColor !== undefined &&
    body.brandColor !== null &&
    !(typeof body.brandColor === "string" && HEX.test(body.brandColor))
  ) {
    problems.push("brandColor must match /^#[0-9A-Fa-f]{6}$/ regular expression");
  }
  if (body.cardDisplay !== undefined) {
    if (!isRecord(body.cardDisplay)) problems.push("cardDisplay must be an object");
    else {
      const c = body.cardDisplay;
      problems.push(
        textProblem("cardDisplay.title", c.title, 40),
        textProblem("cardDisplay.subtitle", c.subtitle, 60),
        c.stampIcon !== undefined && !(STAMP_ICONS as readonly unknown[]).includes(c.stampIcon)
          ? `cardDisplay.stampIcon must be one of the following values: ${STAMP_ICONS.join(", ")}`
          : undefined,
        c.showProgressText !== undefined && typeof c.showProgressText !== "boolean"
          ? "cardDisplay.showProgressText must be a boolean value"
          : undefined,
      );
    }
  }
  if (body.reward !== undefined || creating) {
    if (!isRecord(body.reward)) problems.push("reward must be an object");
    else {
      const r = body.reward;
      problems.push(
        textProblem("reward.nameEn", r.nameEn, 120, {
          min: creating || r.nameEn !== undefined ? 1 : 0,
        }),
        textProblem("reward.nameAm", r.nameAm, 120, { nullable: true }),
        textProblem("reward.descriptionEn", r.descriptionEn, 400, { nullable: true }),
        textProblem("reward.descriptionAm", r.descriptionAm, 400, { nullable: true }),
        intProblem("reward.validForDays", r.validForDays, 1, 3650, true),
      );
      if (creating && typeof r.nameEn !== "string") problems.push("reward.nameEn must be a string");
    }
  }
  return problems.filter((p): p is string => Boolean(p));
}

export function createProgram(store: ProgramStore, email: string, body: unknown): Reply {
  if (!isRecord(body)) return bad(["body must be an object"]);
  const problems = validateFields(body, true);
  if (problems.length) return bad(problems);
  const r = body.reward as Record<string, unknown>;
  const program: Program = {
    id: `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, "0")}`,
    status: "DRAFT",
    isDefault: false,
    nameEn: String(body.nameEn).trim(),
    nameAm: clean(body.nameAm) ?? null,
    termsEn: clean(body.termsEn) ?? null,
    termsAm: clean(body.termsAm) ?? null,
    stampsRequired: (body.stampsRequired as number | undefined) ?? 8,
    cooldownMinutes: (body.cooldownMinutes as number | undefined) ?? 120,
    brandColor: typeof body.brandColor === "string" ? body.brandColor.toUpperCase() : null,
    cardDisplay: (body.cardDisplay as Program["cardDisplay"] | undefined) ?? {},
    reward: {
      id: `reward-${Date.now()}`,
      nameEn: String(r.nameEn).trim(),
      nameAm: clean(r.nameAm) ?? null,
      descriptionEn: clean(r.descriptionEn) ?? null,
      descriptionAm: clean(r.descriptionAm) ?? null,
      validForDays: (r.validForDays as number | null | undefined) ?? null,
    },
    memberCount: 0,
    stampsRequiredLocked: false,
    createdAt: iso(),
    updatedAt: iso(),
  };
  programsFor(store, email).push(program);
  return { status: 201, body: program };
}

export function updateProgram(
  store: ProgramStore,
  email: string,
  id: string,
  body: unknown,
): Reply {
  const program = programsFor(store, email).find((p) => p.id === id);
  if (!program) return notFound();
  if (!isRecord(body)) return bad(["body must be an object"]);
  const problems = validateFields(body, false);
  if (problems.length) return bad(problems);
  if (program.status === "ARCHIVED")
    return conflict("PROGRAM_ARCHIVED", "Archived programs cannot be changed.");
  if (
    typeof body.stampsRequired === "number" &&
    body.stampsRequired !== program.stampsRequired &&
    program.memberCount > 0
  ) {
    return conflict(
      "PROGRAM_LOCKED",
      "The stamp requirement cannot change after customers have joined, because it would alter their progress. Create a new program instead.",
    );
  }
  if (typeof body.nameEn === "string") program.nameEn = body.nameEn.trim();
  for (const key of ["nameAm", "termsEn", "termsAm"] as const) {
    if (body[key] !== undefined) program[key] = clean(body[key]) ?? null;
  }
  if (typeof body.stampsRequired === "number") program.stampsRequired = body.stampsRequired;
  if (typeof body.cooldownMinutes === "number") program.cooldownMinutes = body.cooldownMinutes;
  if (body.brandColor !== undefined) {
    program.brandColor = typeof body.brandColor === "string" ? body.brandColor.toUpperCase() : null;
  }
  if (isRecord(body.cardDisplay)) program.cardDisplay = body.cardDisplay as Program["cardDisplay"];
  if (isRecord(body.reward) && program.reward) {
    const r = body.reward;
    if (typeof r.nameEn === "string") program.reward.nameEn = r.nameEn.trim();
    for (const key of ["nameAm", "descriptionEn", "descriptionAm"] as const) {
      if (r[key] !== undefined) program.reward[key] = clean(r[key]) ?? null;
    }
    if (r.validForDays !== undefined) program.reward.validForDays = r.validForDays as number | null;
  }
  program.updatedAt = iso();
  return { status: 200, body: program };
}

export function changeStatus(
  store: ProgramStore,
  email: string,
  id: string,
  action: "activate" | "pause" | "archive",
): Reply {
  const all = programsFor(store, email);
  const program = all.find((p) => p.id === id);
  if (!program) return notFound();
  let next: Program["status"] | "NOOP" | null;
  if (action === "activate") {
    next =
      program.status === "ACTIVE"
        ? "NOOP"
        : program.status === "DRAFT" || program.status === "PAUSED"
          ? "ACTIVE"
          : null;
  } else if (action === "pause") {
    next = program.status === "PAUSED" ? "NOOP" : program.status === "ACTIVE" ? "PAUSED" : null;
  } else {
    next = program.status === "ARCHIVED" ? "NOOP" : "ARCHIVED";
  }
  if (next === null) {
    return conflict(
      "INVALID_TRANSITION",
      `A ${program.status.toLowerCase()} program cannot be ${action}d.`,
    );
  }
  if (next === "NOOP") return { status: 200, body: program };
  if (action === "activate") {
    if (!program.reward) {
      return conflict(
        "PROGRAM_INCOMPLETE",
        "A program needs an active reward before it can be activated.",
      );
    }
    if (all.some((p) => p.id !== id && p.status === "ACTIVE" && p.isDefault)) {
      return conflict(
        "DEFAULT_PROGRAM_EXISTS",
        "Another program is already the active default. Pause or archive it first.",
      );
    }
  }
  program.status = next;
  program.isDefault =
    action === "activate" ? true : action === "archive" ? false : program.isDefault;
  program.updatedAt = iso();
  return { status: 200, body: program };
}
