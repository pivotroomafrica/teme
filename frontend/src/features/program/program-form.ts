import { z } from "zod";
import type { Program } from "@/lib/api/contract";
import { STAMP_ICONS } from "@/lib/api/contract";
import type { Translate, MessageKey } from "@/lib/i18n/translator";
import type { CreateProgramInput, UpdateProgramInput } from "./api";

/**
 * The program form and how it maps to the backend. The limits mirror `programs.controller.ts` (names 120, reward
 * description 400, terms 2000, card title 40 and subtitle 60, stamps 1-1000, waiting time 0-10,080 minutes, reward
 * validity 1-3,650 days, colour #RRGGBB, five stamp icons). They are only for instant feedback: the backend
 * checks everything again and its refusal is always shown.
 */
export const LIMITS = {
  name: 120,
  rewardDescription: 400,
  terms: 2000,
  cardTitle: 40,
  cardSubtitle: 60,
  stamps: { min: 1, max: 1000 },
  cooldown: { min: 0, max: 10_080 },
  validForDays: { min: 1, max: 3650 },
} as const;

const HEX = /^#[0-9A-Fa-f]{6}$/;

export interface ProgramFormValues {
  nameEn: string;
  nameAm: string;
  rewardNameEn: string;
  rewardNameAm: string;
  rewardDescriptionEn: string;
  rewardDescriptionAm: string;
  validForDays: string;
  stampsRequired: string;
  cooldownMinutes: string;
  termsEn: string;
  termsAm: string;
  brandColor: string;
  cardTitle: string;
  cardSubtitle: string;
  stampIcon: string;
  showProgressText: boolean;
}

export const BLANK_PROGRAM: ProgramFormValues = {
  nameEn: "",
  nameAm: "",
  rewardNameEn: "",
  rewardNameAm: "",
  rewardDescriptionEn: "",
  rewardDescriptionAm: "",
  validForDays: "",
  stampsRequired: "8",
  cooldownMinutes: "120",
  termsEn: "",
  termsAm: "",
  brandColor: "#1B5E3A",
  cardTitle: "",
  cardSubtitle: "",
  stampIcon: "coffee",
  showProgressText: true,
};

export function toFormValues(program: Program): ProgramFormValues {
  return {
    nameEn: program.nameEn,
    nameAm: program.nameAm ?? "",
    rewardNameEn: program.reward?.nameEn ?? "",
    rewardNameAm: program.reward?.nameAm ?? "",
    rewardDescriptionEn: program.reward?.descriptionEn ?? "",
    rewardDescriptionAm: program.reward?.descriptionAm ?? "",
    validForDays: program.reward?.validForDays?.toString() ?? "",
    stampsRequired: String(program.stampsRequired),
    cooldownMinutes: String(program.cooldownMinutes),
    termsEn: program.termsEn ?? "",
    termsAm: program.termsAm ?? "",
    brandColor: program.brandColor ?? "",
    cardTitle: program.cardDisplay.title ?? "",
    cardSubtitle: program.cardDisplay.subtitle ?? "",
    stampIcon: program.cardDisplay.stampIcon ?? "coffee",
    showProgressText: program.cardDisplay.showProgressText ?? true,
  };
}

const wholeNumber = (text: string) => /^\d+$/.test(text.trim());

export function createProgramSchema(t: Translate) {
  const text = (max: number, required = false) =>
    z
      .string()
      .max(max, t("program.errTooLong", { max }))
      .refine((v) => !required || v.trim().length > 0, t("program.errNameRequired"));
  const inRange = (min: number, max: number, message: MessageKey, optional = false) =>
    z.string().refine((v) => {
      if (optional && v.trim() === "") return true;
      return wholeNumber(v) && Number(v) >= min && Number(v) <= max;
    }, t(message));

  return z.object({
    nameEn: text(LIMITS.name, true),
    nameAm: text(LIMITS.name),
    rewardNameEn: text(LIMITS.name, true),
    rewardNameAm: text(LIMITS.name),
    rewardDescriptionEn: text(LIMITS.rewardDescription),
    rewardDescriptionAm: text(LIMITS.rewardDescription),
    validForDays: inRange(
      LIMITS.validForDays.min,
      LIMITS.validForDays.max,
      "program.errDays",
      true,
    ),
    stampsRequired: inRange(LIMITS.stamps.min, LIMITS.stamps.max, "program.errStamps"),
    cooldownMinutes: inRange(LIMITS.cooldown.min, LIMITS.cooldown.max, "program.errCooldown"),
    termsEn: text(LIMITS.terms),
    termsAm: text(LIMITS.terms),
    brandColor: z.string().refine((v) => v === "" || HEX.test(v), t("program.errColor")),
    cardTitle: text(LIMITS.cardTitle),
    cardSubtitle: text(LIMITS.cardSubtitle),
    stampIcon: z.string().refine((v) => (STAMP_ICONS as readonly string[]).includes(v)),
    showProgressText: z.boolean(),
  });
}

const nullable = (v: string) => (v.trim() === "" ? null : v);
const cardDisplayOf = (v: ProgramFormValues) => ({
  ...(v.cardTitle.trim() ? { title: v.cardTitle.trim() } : {}),
  ...(v.cardSubtitle.trim() ? { subtitle: v.cardSubtitle.trim() } : {}),
  stampIcon: v.stampIcon,
  showProgressText: v.showProgressText,
});

/** What to send to create a draft. */
export function toCreateInput(v: ProgramFormValues): CreateProgramInput {
  return {
    nameEn: v.nameEn.trim(),
    nameAm: nullable(v.nameAm),
    termsEn: nullable(v.termsEn),
    termsAm: nullable(v.termsAm),
    stampsRequired: Number(v.stampsRequired),
    cooldownMinutes: Number(v.cooldownMinutes),
    ...(v.brandColor ? { brandColor: v.brandColor } : {}),
    cardDisplay: cardDisplayOf(v),
    reward: {
      nameEn: v.rewardNameEn.trim(),
      nameAm: nullable(v.rewardNameAm),
      descriptionEn: nullable(v.rewardDescriptionEn),
      descriptionAm: nullable(v.rewardDescriptionAm),
      validForDays: v.validForDays.trim() === "" ? null : Number(v.validForDays),
    },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Only the fields that differ from the saved program, so a save never overwrites something this person did not
 * touch (for example a field another manager changed meanwhile). Empty means nothing to save.
 */
export function toPatch(v: ProgramFormValues, saved: Program): UpdateProgramInput {
  const next = toCreateInput(v);
  const patch: UpdateProgramInput = {};
  if (next.nameEn !== saved.nameEn) patch.nameEn = next.nameEn;
  if (next.nameAm !== saved.nameAm) patch.nameAm = next.nameAm;
  if (next.termsEn !== saved.termsEn) patch.termsEn = next.termsEn;
  if (next.termsAm !== saved.termsAm) patch.termsAm = next.termsAm;
  if (next.stampsRequired !== saved.stampsRequired) patch.stampsRequired = next.stampsRequired;
  if (next.cooldownMinutes !== saved.cooldownMinutes) patch.cooldownMinutes = next.cooldownMinutes;
  const color = next.brandColor?.toUpperCase() ?? null;
  if (color !== (saved.brandColor?.toUpperCase() ?? null)) patch.brandColor = color;
  if (!same(next.cardDisplay, { ...saved.cardDisplay })) patch.cardDisplay = next.cardDisplay;

  const reward: NonNullable<UpdateProgramInput["reward"]> = {};
  const r = saved.reward;
  if (next.reward.nameEn !== (r?.nameEn ?? "")) reward.nameEn = next.reward.nameEn;
  if (next.reward.nameAm !== (r?.nameAm ?? null)) reward.nameAm = next.reward.nameAm;
  if (next.reward.descriptionEn !== (r?.descriptionEn ?? null))
    reward.descriptionEn = next.reward.descriptionEn;
  if (next.reward.descriptionAm !== (r?.descriptionAm ?? null))
    reward.descriptionAm = next.reward.descriptionAm;
  if (next.reward.validForDays !== (r?.validForDays ?? null))
    reward.validForDays = next.reward.validForDays;
  if (Object.keys(reward).length > 0) patch.reward = reward;
  return patch;
}

export const hasChanges = (patch: UpdateProgramInput) => Object.keys(patch).length > 0;

/**
 * What members would notice if this patch were saved: their cards, their phone-wallet passes and how the counter
 * treats them all update. Used to warn before saving a program that already has members.
 */
export function memberVisibleFields(patch: UpdateProgramInput): MessageKey[] {
  const out: MessageKey[] = [];
  if (patch.nameEn !== undefined || patch.nameAm !== undefined) out.push("program.fieldName");
  if (patch.reward) out.push("program.fieldReward");
  if (patch.termsEn !== undefined || patch.termsAm !== undefined) out.push("program.fieldTerms");
  if (patch.brandColor !== undefined) out.push("program.fieldColor");
  if (patch.cardDisplay !== undefined) out.push("program.fieldCard");
  if (patch.cooldownMinutes !== undefined) out.push("program.fieldCooldown");
  return out;
}

/** The backend's coded refusals, in words people can act on. */
export const BACKEND_CODE_MESSAGE: Record<string, MessageKey> = {
  PROGRAM_LOCKED: "program.errLocked",
  PROGRAM_ARCHIVED: "program.errArchived",
  DEFAULT_PROGRAM_EXISTS: "program.errDefaultExists",
  PROGRAM_INCOMPLETE: "program.errIncomplete",
  INVALID_TRANSITION: "program.errTransition",
};

/** Maps the backend's field paths ("reward.nameEn") to the form's field names. */
export const FIELD_FOR_PATH: Record<string, keyof ProgramFormValues> = {
  nameEn: "nameEn",
  nameAm: "nameAm",
  termsEn: "termsEn",
  termsAm: "termsAm",
  stampsRequired: "stampsRequired",
  cooldownMinutes: "cooldownMinutes",
  brandColor: "brandColor",
  "cardDisplay.title": "cardTitle",
  "cardDisplay.subtitle": "cardSubtitle",
  "cardDisplay.stampIcon": "stampIcon",
  "reward.nameEn": "rewardNameEn",
  "reward.nameAm": "rewardNameAm",
  "reward.descriptionEn": "rewardDescriptionEn",
  "reward.descriptionAm": "rewardDescriptionAm",
  "reward.validForDays": "validForDays",
};
