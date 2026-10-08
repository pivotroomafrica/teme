# Wallet button artwork

Place the **official, unmodified** button files supplied by Apple and Google here, then register their paths in
`src/features/wallet/brand.ts` (`OFFICIAL_WALLET_BUTTONS`), for example `{ en: "/wallet/add-to-apple-wallet.svg" }`.

- Apple: "Add to Apple Wallet" badge, from Apple's Add to Apple Wallet guidelines.
- Google: "Add to Google Wallet" button, from Google's Wallet brand guidelines.

Both brands restrict how their artwork may be altered (size, spacing, colours, wording, language variants), so do
not edit the files. They are not committed because their licence is the brand owners', not this project's.

No Apple or Google signing certificates or API credentials ever belong in this repository or in the frontend:
the backend creates and signs wallet passes.
