import { PKPass } from 'passkit-generator';
import {
  PassState,
  isLive,
  parseColor,
  pick,
  progressText,
  readableTextColor,
} from '../../domain/pass-state';
import type { AppleConfig } from './apple-config';
import { iconPng, stripPng } from './images';

const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// Field labels are localized by Apple per device language through .lproj files; the VALUES below follow
// the customer's preferred language. Amharic wording should be reviewed by a native speaker.
const LABELS = {
  en: { STAMPS: 'STAMPS', REWARD: 'REWARD', READY: 'REWARDS READY', TERMS: 'Terms' },
  am: { STAMPS: 'ስታምፕ', REWARD: 'ሽልማት', READY: 'ዝግጁ ሽልማቶች', TERMS: 'ደንቦች' },
} as const;

/**
 * Builds and signs a .pkpass for one wallet pass. Pure apart from signing: the same state always
 * produces the same content, and nothing here logs certificates or keys.
 */
export function buildPkPass(
  state: PassState,
  cfg: AppleConfig,
  authenticationToken: string,
): Buffer {
  const bg = parseColor(state.brandColor);
  const fg = readableTextColor(bg);
  const live = isLive(state.status);

  const pass = new PKPass({}, cfg.certificates, {
    formatVersion: 1,
    passTypeIdentifier: cfg.passTypeId,
    teamIdentifier: cfg.teamId,
    serialNumber: state.passId,
    organizationName: cfg.organizationName,
    description: `${pick(state.programName, state.language)} loyalty card`,
    logoText: pick(state.merchantName, state.language),
    foregroundColor: rgb(fg),
    labelColor: rgb(fg),
    backgroundColor: rgb(bg),
    webServiceURL: cfg.webServiceUrl,
    authenticationToken,
    // A suspended or invalidated pass is shown as void and loses its barcode.
    voided: !live,
  });
  pass.type = 'storeCard';

  pass.primaryFields.push({ key: 'stamps', label: 'STAMPS', value: progressText(state) });
  if (state.reward) {
    pass.secondaryFields.push({
      key: 'reward',
      label: 'REWARD',
      value: pick(state.reward.name, state.language),
    });
  }
  pass.auxiliaryFields.push({
    key: 'ready',
    label: 'READY',
    value: String(state.rewardsAvailable),
  });
  if (state.firstName) {
    pass.headerFields.push({ key: 'name', label: '', value: state.firstName });
  }
  const terms = pick(state.terms, state.language);
  if (terms) pass.backFields.push({ key: 'terms', label: 'TERMS', value: terms });

  if (live && state.barcode) {
    pass.setBarcodes({
      format: 'PKBarcodeFormatQR',
      message: state.barcode,
      messageEncoding: 'iso-8859-1',
    });
  }

  pass.addBuffer('icon.png', iconPng(state.brandColor, 29));
  pass.addBuffer('icon@2x.png', iconPng(state.brandColor, 58));
  pass.addBuffer('strip.png', stripPng(state, 1));
  pass.addBuffer('strip@2x.png', stripPng(state, 2));

  for (const lang of ['en', 'am'] as const) {
    pass.localize(lang, {
      STAMPS: LABELS[lang].STAMPS,
      REWARD: LABELS[lang].REWARD,
      READY: LABELS[lang].READY,
      TERMS: LABELS[lang].TERMS,
    });
  }

  return pass.getAsBuffer();
}
