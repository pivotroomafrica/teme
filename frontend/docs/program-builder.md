# Program builder and QR materials (`/[locale]/dashboard/program`)

Needs `program:read` to open the page and `program:manage` to change anything (owners and managers have both; the account list for each is decided by the backend). Without `program:manage` every field is read-only and no save or status button exists, but the previews and the QR materials can still be looked at.

## The program

Fields (English and Amharic where the product has both): program name, reward name and description, reward validity in days, stamps needed, minutes between stamps, terms, brand colour, and the card look (title, subtitle, stamp icon, whether to print "3 of 8"). Status is DRAFT, ACTIVE, PAUSED or ARCHIVED.

### What the backend decides (the page never assumes)

| Rule                                                                                                                                                                     | Backend                | On the page                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Limits: names 120, reward description 400, terms 2000, card title 40 / subtitle 60, stamps 1-1000, waiting time 0-10,080, validity 1-3,650, colour `#RRGGBB`, five icons | validation             | The same limits give instant messages (`program-form.ts`); the backend's own refusal is always shown too, at the field when it names one |
| Stamp requirement locks once any customer has joined (`409 PROGRAM_LOCKED`)                                                                                              | `stampsRequiredLocked` | Field disabled with the reason ("because 12 customers have joined... create a new program"); a refusal is still explained                |
| Lifecycle: DRAFT to ACTIVE, ACTIVE and PAUSED both ways, anything to ARCHIVED (final)                                                                                    | `INVALID_TRANSITION`   | Only the moves that make sense are offered; a refusal is explained                                                                       |
| One active default program (`409 DEFAULT_PROGRAM_EXISTS`)                                                                                                                | on activate            | A warning appears when another program is live, and the attempt is still sent so the backend has the last word                           |
| A program needs a reward (`PROGRAM_INCOMPLETE`)                                                                                                                          | on activate            | Explained                                                                                                                                |
| Archived programs cannot change (`PROGRAM_ARCHIVED`)                                                                                                                     | on edit                | Read-only with "nothing was deleted"                                                                                                     |

### Saving

- Save only sends **the fields that changed** (`toPatch`), so it never overwrites something this person did not touch. Optional text that is cleared is sent as `null`, never as an empty string.
- Saving a change that members will see (names, reward, terms, colour, card look, waiting time) on a program that already has members first asks: "These changes reach 12 members... What changes: name." Nothing is sent until confirmed. Programs with no members save without the extra step.
- **Create** makes a DRAFT; nothing is public until it is published.
- **Publish / Resume, Pause, Archive** each ask first. Pause says members keep everything; Archive says it is final and needs the typed word `ARCHIVE`. Publish is disabled while there are unsaved changes ("Save your changes before publishing").
- **Unsaved changes**: a banner, a browser prompt when the tab is closed or reloaded, and a confirmation before following a link to another page of the site (`useUnsavedChangesWarning`). After a successful save the warning stops.
- Every "saved" message appears only after the backend answered; the list is asked for again afterwards.

### Previews

Three live previews of the form as it is now, saved or not: the **join page** (the real customer component), the **web card** and a **wallet-card sketch**, with a choice of English or Amharic for the business's own wording and a slider for sample stamps. They use sample data only (no real customer, no real QR code), and they say real Apple and Google passes are drawn by those companies and will look slightly different.

## Join QR and posters (second tab)

- **The link** is built from this site's own origin and the business's public join reference (`GET /merchant/profile` → `joinReference`). English and Amharic posters open `/en/join/...` or `/am/join/...`; the bilingual poster opens `/join/...` and each visitor lands in their own language. **No internal business, program, branch or staff identifier is ever in a code** (tests check for UUIDs and the words merchant/program/branch/staff).
- The QR picture is made on the server from that link; nothing is computed from private data.
- **Poster**: A4 proportions, business, what customers earn (as the business wrote it), a large QR code with a heavy border, three steps, the link printed in text, in English, Amharic or both. The print stylesheet prints only the poster; choose "Save as PDF" in the print window for a file.
- **Downloads**: the code as SVG or PNG (`join-qr-en.svg`, `join-qr-am.png`...). A finished poster file is not generated (that would need a PDF library or a server renderer); printing to PDF covers it.
- **One code per branch is not available**: the backend's join link has no branch, so all branches use the same code. The page says so.
- The **logo** cannot be added: logo upload exists only as a placeholder in the backend ("upload-ready only"). The poster uses a coloured monogram.
- If no program is the active default, the page warns that customers cannot join yet. If the backend gives no join reference, no code is made and the page says so.

## Backend gaps noticed

- **No branch parameter on the join link**, so no branch-specific QR (and no way to see which branch recruited a member).
- **Logo upload** is metadata only.
- **No read-only role exists**: owners and managers both hold `program:manage`, so the read-only view is reachable only by a future custom role. The mock has `viewer@mock.test` to exercise it.
- **No "members affected" preview** beyond `memberCount`; the backend also gives no list of which wallet passes an edit will refresh.
- The reward is a single object per program; "rewards" as a list (campaigns) is a later step.

## Testing

Unit: `program-form.test.ts` (every limit, the diff, member-visible fields), `qr-links.test.ts`, `program-workspace.test.tsx` (permissions, validation, saving, the member warning, create, publish / pause / resume / archive, backend refusals, unsaved changes, live previews), `join-materials.test.tsx` (languages, links, downloads, print, unavailable capabilities). End to end (`tests/e2e/program.spec.ts`, phone and desktop): all of that in a real browser, including downloads, print media, the read-only account, Amharic and accessibility.
