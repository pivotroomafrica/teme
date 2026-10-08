# Wallet selection and the customer web card

## Where the card lives

A card token is the customer's only credential, and the backend shows it once. The browser never keeps it in `localStorage`, `sessionStorage` or IndexedDB, and never holds it in page scripts after hand-over.

1. After sign-up (or from a saved link) the token goes **once** to `POST /api/card/session`. The server checks it with the backend and stores it in a sealed (AES-GCM) **HttpOnly, SameSite=Lax** cookie, `tc_card`, valid for about a year. The answer carries only an opaque card id.
2. From then on the browser names a card by that id (`/card?c=<id>`). The card page, wallet links, marketing withdrawal and card removal all run on the server, which reads the token from the cookie.
3. A link handed over in the address fragment (`/card#t=<token>`) is claimed the same way and removed from the address bar at once, so it is not left in history, screenshots or shared links. Fragments are never sent to a server.
4. A customer can belong to several businesses: the cookie holds up to 5 cards (newest first); the card page lists the others. Cookies are scoped to the browser, so a card on a shared phone can be removed from the phone (`Remove this card from this phone`); the membership itself is untouched.

Endpoints (all refuse anything that is not a same-origin call from the app: custom header + `Origin`/`Sec-Fetch-Site` check, 4 KB body limit, tokens must match `^[A-Za-z0-9._~-]{8,256}$`): `POST/DELETE /api/card/session`, `POST /api/card/wallet-link`, `DELETE /api/card/marketing`.

## Wallet selection (`/[locale]/card/wallet`, and the step after sign-up)

- States plainly that this is a loyalty card, not a payment card.
- Shows the wallet that suits the phone when it can be told reliably (iPhone/iPad → Apple Wallet, Android → Google Wallet) and **both** otherwise (desktop, unfamiliar or privacy-masked devices). The web card is always offered.
- A wallet the backend reported unavailable (at sign-up) is shown disabled with a reason; later, when availability is not known, the backend's answer decides and a refusal points to the web card.
- The wallet link is created by the backend, which holds the signing credentials. The browser only receives an `https://` address and opens it. No Apple or Google credential exists in the frontend.
- **Official button artwork is not bundled.** Apple and Google require their own supplied artwork, unmodified, and license it under their brand terms. `src/features/wallet/brand.ts` and `public/wallet/README.md` say where to download it and where to register it; until then the buttons are plain black text buttons with no company logo. **Action needed before launch.**

## The web card (`/[locale]/card`)

Merchant branding (brand colour and monogram: the API has no logo), customer first name, stamp progress, program reward and description (shown as the business wrote it), "reward waiting" banner, QR code, last-updated time, program terms, support link, and actions (refresh, add to wallet, stop marketing, remove). There is no purchase value, price or payment information: the backend has none.

- **QR code:** generated on the server from `card.barcode`, which the backend supplies (the card token itself). Nothing is computed in the browser, nothing else is encoded (no name, phone or business). It is not shown as text.
- **Inactive memberships:** paused, no longer valid and still-being-prepared cards say so and hide the QR code and wallet link; a paused card keeps its stamps visible ("your stamps are safe").
- **Freshness:** the page is rendered per request and never cached. It refreshes when the phone comes back to the page after 30 s or more, and the Refresh button re-reads it. "Last updated" is when the page was read: the backend does not return an update time for the web card.
- **Failures:** a card that cannot be loaded right now (busy, offline) keeps its place on the phone and shows a retry link; a card the backend no longer knows offers removal from the phone.
- **Support link:** optional `NEXT_PUBLIC_SUPPORT_URL` (an `https://` page or `mailto:`); without it the page says to ask the staff.

## Security notes

- Pages are `noindex` (header and meta) and not cached; no analytics or third-party scripts; the card page sends no membership data anywhere except the backend.
- **Known risks, not solvable in the frontend:** the web card QR is the static card token, so a copied URL (not possible: the token is not in it) or a screenshot of the QR works until the card is re-issued. The card says so ("do not share a screenshot"). A rotating or short-lived code would need a backend change.
- The card token is still readable by the server (it must be, to call the backend). The cookie is only as safe as `TC_SESSION_SECRET`.

## Backend gaps noticed

- The web card has no `updatedAt` (the pass state has one; the web response drops it).
- Backend suggests offline display of the last QR; not built here (it would mean a service worker caching a private page). Candidate for the final hardening step.
- No customer-side recovery of a lost card, and the web QR cannot be rotated.
- No merchant logo or support contact in the card response.

## Testing

Unit: `src/lib/card/cards.test.ts`, `src/app/api/card-routes.test.ts`, `src/features/wallet/*.test.ts(x)` (Apple, Google, web fallback, unavailable wallet, non-https link refused), `src/features/card/**` (active, reward, redeemed, paused/invalid/pending, Amharic, support link, no payment wording, QR). End to end (mock backend, phone and desktop): `tests/e2e/card.spec.ts` (hand-over and persistence, token never visible to scripts, empty/invalid/outage/flaky states, several cards, remove, stop marketing, noindex and no-store, foreign requests refused, wallet screen on Android and iPhone, accessibility, the sign-up to card flow).
