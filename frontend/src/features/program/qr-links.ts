/**
 * The addresses a join QR code opens. They are built only from this site's own origin and the business's PUBLIC
 * join reference, which the backend supplies (`GET /merchant/profile` -> `joinReference`). No internal business,
 * program, branch or staff identifier is ever encoded in a code.
 *
 *  - English / Amharic poster: the page in that language.
 *  - Bilingual poster: the address without a language, which this site sends to each visitor's own language.
 */
export type PosterLanguage = "en" | "am" | "both";

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

/** True for a reference that can safely sit in an address. */
export const isJoinReference = (value: string | null | undefined): value is string =>
  typeof value === "string" && REFERENCE.test(value);

export function joinUrl(origin: string, reference: string, language: PosterLanguage): string {
  const base = origin.replace(/\/+$/, "");
  const path = `/join/${encodeURIComponent(reference)}`;
  return language === "both" ? `${base}${path}` : `${base}/${language}${path}`;
}
