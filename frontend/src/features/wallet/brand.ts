import type { WalletProvider } from "./device";

/**
 * Official "Add to Apple Wallet" and "Add to Google Wallet" button artwork.
 *
 * Both companies require their own supplied artwork (and localized variants) to be used unmodified, and the
 * files are licensed under their brand terms, so they are NOT bundled here. Download them from:
 *   - Apple:  https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/
 *   - Google: https://developers.google.com/wallet/generic/resources/brand-guidelines
 * put them in `public/wallet/` (see the README there), and list the paths below. Until a path is set, the
 * button is a plain, clearly labelled stand-in (black, white text) that shows no company logo.
 */
export const OFFICIAL_WALLET_BUTTONS: Record<WalletProvider, { en: string; am?: string } | null> = {
  APPLE: null,
  GOOGLE: null,
};
