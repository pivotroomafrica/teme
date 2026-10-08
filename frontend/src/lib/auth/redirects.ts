import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { splitLocale } from "@/lib/i18n/resolve-locale";
import { canAccess, type Principal } from "./permissions";

/**
 * "Send me back where I was" without opening a redirect hole. Only a same-site path is ever returned:
 * anything with a scheme, host, protocol-relative start, backslash, control character, traversal or
 * encoded trick yields null, and the caller falls back to the person's own home page.
 */
const MAX_LENGTH = 1024;
const CONTROL = /[\u0000-\u001f\u007f]/;

function decodesSafely(value: string): string | null {
  let current = value;
  // Decode repeatedly so double-encoded tricks (%252F) are caught too.
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

const looksDangerous = (value: string) =>
  CONTROL.test(value) ||
  /\s/.test(value) ||
  value.includes("\\") ||
  value.startsWith("//") ||
  /^[a-z][a-z0-9+.-]*:/i.test(value) ||
  value.split("/").includes("..");

/** The path (and query) to return to, with a language prefix, or null if `next` is not a safe local path. */
export function safeNextPath(
  next: string | null | undefined,
  options: { locale: Locale; principal?: Principal },
): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_LENGTH) return null;
  if (!next.startsWith("/") || looksDangerous(next)) return null;
  const decoded = decodesSafely(next);
  if (decoded === null || looksDangerous(decoded)) return null;

  let url: URL;
  try {
    url = new URL(next, "http://redirect.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://redirect.invalid") return null;

  const { locale: pathLocale, rest } = splitLocale(url.pathname);
  // Never bounce people back into the sign-in / error pages.
  if (/^\/(login|session-expired|denied)(\/|$)/.test(rest)) return null;
  if (options.principal && !canAccess(rest, options.principal)) return null;

  const locale = pathLocale && isLocale(pathLocale) ? pathLocale : options.locale;
  return `/${locale}${rest === "/" ? "" : rest}${url.search}`;
}

/** Same rule for a language-less location read from a URL parameter, defaulting to English. */
export const safeNextOrNull = (next: string | null | undefined, principal?: Principal) =>
  safeNextPath(next, { locale: defaultLocale, principal });
