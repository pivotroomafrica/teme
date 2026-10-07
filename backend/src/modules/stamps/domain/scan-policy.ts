/** Safe, client-facing reasons a scan can be refused. They reveal nothing about other tenants or internals. */
export const REJECTION_REASONS = [
  'BRANCH_NOT_PERMITTED',
  'INVALID_TOKEN',
  'MEMBERSHIP_INACTIVE',
  'PROGRAM_INACTIVE',
  'COOLDOWN_ACTIVE',
  'NO_REWARD_AVAILABLE',
  'REWARD_NOT_AVAILABLE',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface Message {
  en: string;
  am: string;
}

// Amharic wording should be reviewed by a native speaker before launch.
export const MESSAGES = {
  BRANCH_NOT_PERMITTED: {
    en: 'You are not allowed to stamp at this branch.',
    am: 'በዚህ ቅርንጫፍ ማህተም ማድረግ አይፈቀድልዎትም።',
  },
  INVALID_TOKEN: { en: 'This card is not valid.', am: 'ይህ ካርድ ትክክለኛ አይደለም።' },
  MEMBERSHIP_INACTIVE: {
    en: 'This membership is not active.',
    am: 'ይህ አባልነት ንቁ አይደለም።',
  },
  PROGRAM_INACTIVE: {
    en: 'This loyalty program is not accepting stamps right now.',
    am: 'ይህ የታማኝነት ፕሮግራም አሁን ስታምፕ አይቀበልም።',
  },
  COOLDOWN_ACTIVE: {
    en: 'Too soon for another stamp.',
    am: 'ሌላ ስታምፕ ለመስጠት ገና ነው።',
  },
  NO_REWARD_AVAILABLE: {
    en: 'This customer has no reward to redeem.',
    am: 'ይህ ደንበኛ የሚወስደው ሽልማት የለውም።',
  },
  REWARD_NOT_AVAILABLE: {
    en: 'This reward cannot be redeemed.',
    am: 'ይህ ሽልማት መወሰድ አይችልም።',
  },
  REWARD_REDEEMED: { en: 'Reward redeemed.', am: 'ሽልማቱ ተሰጥቷል።' },
  ELIGIBLE: { en: 'Ready to stamp.', am: 'ማህተም ለማድረግ ዝግጁ ነው።' },
  STAMPED: { en: 'Stamp added.', am: 'ስታምፕ ተጨምሯል።' },
  REWARD_UNLOCKED: { en: 'Stamp added. Reward unlocked!', am: 'ስታምፕ ተጨምሯል። ሽልማት ተከፍቷል!' },
} as const satisfies Record<string, Message>;

/** The larger of the program cooldown and the built-in double-scan guard. */
export function effectiveCooldownSeconds(
  programCooldownMinutes: number,
  floorSeconds: number,
): number {
  return Math.max(programCooldownMinutes * 60, floorSeconds);
}

/** Whole seconds until the next stamp is allowed; 0 when allowed now. Rounds up so clients never retry early. */
export function cooldownRemainingSeconds(
  lastStampAt: Date | null,
  now: Date,
  cooldownSeconds: number,
): number {
  if (!lastStampAt || cooldownSeconds <= 0) return 0;
  const elapsedMs = now.getTime() - lastStampAt.getTime();
  const remainingMs = cooldownSeconds * 1000 - elapsedMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
