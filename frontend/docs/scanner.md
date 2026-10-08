# Staff scanner (`/[locale]/staff/scanner`)

Phone-first screen for branch staff, owners and managers who hold `stamp:create`. It always works at one known branch (the remembered choice, the only branch, or the person chooses at `/staff/branch`); the server validates that branch and the browser sends it with every request.

## Workflow

1. **Read a code**: the camera reads a QR code, or staff type the card code. Only a plain card token is accepted (`parseScannedCode`); a menu link, Wi-Fi code or phone number is shown as "not a loyalty card" and never leaves the phone.
2. **Check** (two read-only questions, asked together): `POST /scanner/validate` ("can this card be stamped now?") and `POST /scanner/rewards/lookup` ("is a reward waiting?"). The browser never works out eligibility.
3. **Confirm**: first name, progress, and two _separate_ sections:
   - **Add stamp**: only when the backend answered `ELIGIBLE`.
   - **Reward available / Redeem reward**: only when the backend lists rewards. Redeeming opens a confirmation naming the customer and the reward ("This cannot be undone").
     A cooldown or inactive membership blocks the stamp but leaves an available reward reachable.
4. **Submit** with one fresh idempotency key per action (`POST /scanner/stamps`, `POST /scanner/redemptions`).
5. **Result**: a full-width banner, readable at arm's length. Success is green with a tick and the words "Stamp added" / "Reward redeemed"; refusals are red with a cross and a headline in words (card not recognised, membership not active, not allowed at this branch...); a cooldown is amber with a warning symbol and the wait in minutes. A successful stamp returns to scanning by itself after 6 s; everything else waits for "Scan next card".
6. **Back to scanning.** A card that was just handled is ignored until it has left the camera picture, so a customer still holding the card up is not stamped (or refused) twice.

## Safety rules

- **No offline stamping.** Offline, the connection state says so, the code box and lookup are disabled and "Add stamp" / "Redeem" are disabled. Nothing is queued and nothing is shown as done unless the backend confirmed it.
- **Unknown is not failed.** If a stamp or redemption loses its connection, times out or gets a server error, the screen says the result is _unknown_ and asks staff to **Check again**, which re-sends the very same request with the **same idempotency key** (the backend answers with the original result, `replayed: true`). It is always a tap, never automatic; redemptions are never retried by themselves.
- **Double taps**: the action buttons are guarded by a busy flag, the screen changes to "Adding the stamp..." immediately, and the confirmation dialog locks while it runs.
- **Permission denied (403)** is shown as such, with no retry. A 401 sends the person to sign in again (the session watcher).
- **Wrong business** cannot be told apart from an unknown card (the backend answers `INVALID_TOKEN` for both, on purpose), so one message covers both.

## Camera

- Starts only when staff press _Start camera_; `getUserMedia` with the rear camera preferred, audio off.
- **Flash** button appears only when the camera reports torch support.
- Frames are drawn to a small off-screen canvas (at most 640 px wide), decoded with `jsQR` (loaded on first use), and overwritten by the next frame. Nothing is recorded, saved, turned into an image file or uploaded; stopping clears the canvas.
- The camera is released when staff press _Stop camera_, when the page is hidden (and restarted when it returns), on `pagehide`, and when staff navigate away. E2E tests check that no track is left live.
- States: starting, live, permission refused, no usable camera, insecure page (camera needs https or localhost), other error, each with a plain explanation, a retry, and manual entry still working.

## Manual fallback

- **Card code**: type or paste the code. Checked exactly like a scan.
- **Phone number**: `GET /merchant/customers?q=` (read-only). Branch staff must give the complete number and see masked numbers. It confirms that the member exists and is active, then asks to scan their card. **It cannot add a stamp**: see the gap below.

## Recent activity

A list of what _this phone_ did since the page was opened (first name, what happened, time). It lives in memory only and is gone on reload. No phone number or card code is ever stored or shown. (`GET /merchant/staff/{id}/activity` exists but needs `staff:read`, which branch staff do not have.)

## Backend gaps noticed

- **No stamping by customer.** The scanner endpoints take only a card token, so a lost or unreadable QR cannot be worked around with a phone number. A `membershipId`-based stamp, or a short manual code printed under the QR, would complete the fallback the product asks for. (The web card deliberately does not show the token as text.)
- **No staff-readable recent activity** for the person's own device or branch (the activity feed needs `staff:read`).
- `rewards/lookup` and `validate` are two calls; one combined "scan" answer would save a round trip on slow connections.
- The business name is not readable by branch staff, so the screen shows the branch only (the shell already shows who is signed in).

## Testing

- Unit: `scanner-flow.test.ts` (every transition, failure classification, rejections), `qr-input.test.ts` (decodes a real rendered QR; rejects non-cards), `scanner-app.test.tsx` (the whole screen against a mocked API: stamping, keys, double taps, rejections in both languages, rewards and confirmation, lost connections and retries, offline, recent activity, phone lookup).
- End to end (`tests/e2e/scanner.spec.ts`, phone and desktop, mock backend): Chromium's **fake camera shows a real QR picture** so the decode path is exercised for real; plus typed codes, every rejection, rewards, abort/503/403 responses, offline, camera refused and unsupported, no uploads or stored images, camera released on stop and on leaving, accessibility and touch-target size.
