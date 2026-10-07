export type WalletProviderKey = 'APPLE' | 'GOOGLE' | 'WEB';
export type PassStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'INVALIDATED';
export type Language = 'EN' | 'AM';

export interface Bilingual {
  en: string;
  am: string | null;
}

/**
 * Provider-neutral snapshot of everything a wallet card shows. Built fresh from the ledger each time,
 * so a retry always pushes the CURRENT truth rather than a stale queued value.
 */
export interface PassState {
  passId: string;
  membershipId: string;
  programId: string;
  provider: WalletProviderKey;
  status: PassStatus;
  language: Language;
  /** Bumped whenever the content should be refreshed. */
  version: number;
  updatedAt: Date;
  merchantName: Bilingual;
  programName: Bilingual;
  /** Customer's first name, shown on the card; null when unknown. */
  firstName: string | null;
  brandColor: string | null;
  stampsRequired: number;
  currentStamps: number;
  completedCards: number;
  rewardsAvailable: number;
  reward: { name: Bilingual; description: Bilingual } | null;
  terms: Bilingual;
  /** Opaque scan value for the QR code. Null for the web pass (it shows the card token instead). */
  barcode: string | null;
}

export const pick = (text: Bilingual, language: Language): string =>
  language === 'AM' && text.am ? text.am : text.en;

export const progressText = (state: Pick<PassState, 'currentStamps' | 'stampsRequired'>): string =>
  `${state.currentStamps} / ${state.stampsRequired}`;

export const isLive = (status: PassStatus): boolean => status === 'ACTIVE' || status === 'PENDING';

/** Hex colour to [r,g,b]; falls back to a neutral dark when missing or malformed. */
export function parseColor(hex: string | null): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!m) return [51, 51, 51];
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Black or white, whichever reads better on the given background (WCAG relative luminance). */
export function readableTextColor(bg: [number, number, number]): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(bg[0]) + 0.7152 * lin(bg[1]) + 0.0722 * lin(bg[2]);
  return lum > 0.4 ? [0, 0, 0] : [255, 255, 255];
}
