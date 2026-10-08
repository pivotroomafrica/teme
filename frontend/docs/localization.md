# Localization

English (`en`) and Amharic (`am`). Amharic is written left to right, so nothing is mirrored.

- **Routes:** every page lives under `/en` or `/am`. `src/proxy.ts` sends a visitor without a prefix to their saved choice (`tc_locale` cookie, a preference, not a credential), then the browser's `Accept-Language`, then English. Visiting the other language's page saves the new choice. Unknown languages are 404s.
- **Dictionaries:** `src/lib/i18n/messages/{en,am}.ts`, grouped by feature (`common`, `errors`, `ui`, `nav`, `auth`, `enrollment`, `wallet`, `loyalty`, `reward`, `scanner`, `confirm`, `areas`). English defines the keys; the Amharic file must satisfy the same type, and `messages/parity.test.ts` checks keys, placeholders and that sentences are not left in English. Amharic wording needs native-speaker review before launch.
- **Using text:** Server Components call `getTranslator(locale)`; Client Components call `useT()`. Keys are typed, so typos fail the type check. A page sends the browser only the namespaces it lists in the layout (`pickNamespaces`); add a namespace there when a page starts using it.
- **No hardcoded text:** `no-hardcoded-text.test.ts` scans components for plain-English JSX text and `aria-label`/`title`/`placeholder`/`alt` strings.
- **Fallback:** a missing Amharic key shows the English text; in development the console warns `[i18n] Missing "am" translation for "<key>"`.
- **Dates and numbers:** `createFormatter(locale)` (`getFormatter` on the server, `useFormat()` in the browser). Gregorian dates in the Africa/Addis_Ababa time zone, Latin digits 0-9, relative times, lists. Bad dates show "—".
- **Phone numbers:** `src/lib/i18n/phone.ts` accepts the same spellings as the backend, stores/sends `+251…`, and shows `091 123 4567` (national) or `+251 91 123 4567` (international); `maskEthiopianPhone` hides the middle digits.
- **Metadata:** `pageMetadata()` translates titles; the layout sets description and `og:locale`; the home page declares its canonical URL and `hreflang` alternates (other pages are `noindex`).
- **Merchant text is never translated:** program names, reward descriptions and terms are shown exactly as the business wrote them (`loyalty.merchantText` labels them where useful).
- **Long Amharic text:** Ethiopic words run longer than English ones; components wrap rather than clip, and `tests/e2e/localization.spec.ts` plus the design-system spec check for clipping and sideways scrolling.
