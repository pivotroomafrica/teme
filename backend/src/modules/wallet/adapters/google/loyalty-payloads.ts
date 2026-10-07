import { PassState, PassStatus, isLive, pick, progressText } from '../../domain/pass-state';
import type { GoogleConfig } from './google-config';

const compact = (uuid: string) => uuid.replace(/-/g, '');

/** One loyalty class per merchant program, one loyalty object per membership pass. */
export const classIdFor = (issuerId: string, programId: string) =>
  `${issuerId}.program_${compact(programId)}`;
export const objectIdFor = (issuerId: string, passId: string) =>
  `${issuerId}.pass_${compact(passId)}`;

/** Google's loyalty object states. Suspended passes go INACTIVE; invalidated ones EXPIRED. */
export function objectStateFor(status: PassStatus): 'ACTIVE' | 'INACTIVE' | 'EXPIRED' {
  if (status === 'SUSPENDED') return 'INACTIVE';
  if (status === 'INVALIDATED') return 'EXPIRED';
  return 'ACTIVE';
}

const localized = (en: string, am: string | null) => ({
  defaultValue: { language: 'en', value: en },
  ...(am ? { translatedValues: [{ language: 'am', value: am }] } : {}),
});

const STRINGS = {
  stamps: { en: 'Stamps', am: 'ስታምፕ' },
  reward: { en: 'Reward', am: 'ሽልማት' },
  ready: { en: 'Rewards ready', am: 'ዝግጁ ሽልማቶች' },
} as const;

export function buildLoyaltyClass(state: PassState, cfg: GoogleConfig) {
  return {
    id: classIdFor(cfg.issuerId, state.programId),
    issuerName: state.merchantName.en,
    localizedIssuerName: localized(state.merchantName.en, state.merchantName.am),
    programName: state.programName.en,
    localizedProgramName: localized(state.programName.en, state.programName.am),
    programLogo: {
      sourceUri: { uri: cfg.defaultLogoUrl },
      contentDescription: { defaultValue: { language: 'en', value: state.merchantName.en } },
    },
    ...(state.brandColor ? { hexBackgroundColor: state.brandColor.toLowerCase() } : {}),
    // Demo classes stay private to Console test users; production classes are submitted for review.
    reviewStatus: cfg.environment === 'production' ? 'UNDER_REVIEW' : 'DRAFT',
    // Without this, Google would let a customer add the same card repeatedly.
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  };
}

/** The mutable part of a loyalty object: everything that changes after a stamp, redemption or reversal. */
type LocalizedString = {
  defaultValue: { language: string; value: string };
  translatedValues?: Array<{ language: string; value: string }>;
};

// A type alias (not an interface) so it is assignable to the REST client's Record<string, unknown>.
export type ObjectPatch = {
  /** The first name shown on the card; a neutral word once the customer has been anonymized. */
  accountName: string;
  state: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  loyaltyPoints: { label: string; localizedLabel: LocalizedString; balance: { string: string } };
  textModulesData: Array<Record<string, unknown>>;
  barcode?: { type: string; value: string; alternateText?: string };
};

export function buildObjectPatch(state: PassState): ObjectPatch {
  return {
    accountName: state.firstName ?? 'Member',
    state: objectStateFor(state.status),
    loyaltyPoints: {
      label: STRINGS.stamps.en,
      localizedLabel: localized(STRINGS.stamps.en, STRINGS.stamps.am),
      balance: { string: progressText(state) },
    },
    textModulesData: [
      ...(state.reward
        ? [
            {
              id: 'reward',
              header: STRINGS.reward.en,
              body: pick(state.reward.name, 'EN'),
              localizedHeader: localized(STRINGS.reward.en, STRINGS.reward.am),
              localizedBody: localized(state.reward.name.en, state.reward.name.am),
            },
          ]
        : []),
      {
        id: 'ready',
        header: STRINGS.ready.en,
        body: String(state.rewardsAvailable),
        localizedHeader: localized(STRINGS.ready.en, STRINGS.ready.am),
      },
    ],
    // A PATCH cannot delete a field, so a suspended or invalidated pass swaps its barcode for an
    // obviously void one. (The scanner already refuses the old value; this is for the customer's eyes.)
    ...(isLive(state.status)
      ? state.barcode
        ? { barcode: { type: 'QR_CODE', value: state.barcode } }
        : {}
      : { barcode: { type: 'QR_CODE', value: 'VOID', alternateText: 'Card revoked' } }),
  };
}

export function buildLoyaltyObject(state: PassState, cfg: GoogleConfig) {
  return {
    id: objectIdFor(cfg.issuerId, state.passId),
    classId: classIdFor(cfg.issuerId, state.programId),
    accountId: compact(state.passId),
    ...buildObjectPatch(state),
  };
}
