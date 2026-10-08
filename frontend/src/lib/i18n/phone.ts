/**
 * Ethiopian phone numbers: parsing and presentation.
 *
 * Parsing mirrors the backend (`backend/src/common/phone/ethiopian-phone.ts`): the backend stays the authority,
 * this only lets forms give instant feedback and show numbers the way people write them. The 9-digit national
 * number must start with 1-5 (landline), 7 or 9 (mobile).
 */
const NATIONAL_NUMBER = /^[1-579][0-9]{8}$/;
const E164 = /^\+251([1-579][0-9]{8})$/;

/** `+251911234567` for any accepted spelling, or `null` when the input is not an Ethiopian number. */
export function normalizeEthiopianPhone(input: string): string | null {
  if (typeof input !== "string") return null;
  const stripped = input.trim().replace(/[\s\-.()]/g, "");
  if (!/^\+?[0-9]+$/.test(stripped)) return null;

  let digits = stripped.startsWith("+") ? stripped.slice(1) : stripped;
  if (stripped.startsWith("+") && !digits.startsWith("251")) return null;

  if (digits.startsWith("00251")) digits = digits.slice(5);
  else if (digits.startsWith("251")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  return NATIONAL_NUMBER.test(digits) ? `+251${digits}` : null;
}

export type PhoneStyle = "national" | "international";

function group(national: string): [string, string, string] {
  return [national.slice(0, 2), national.slice(2, 5), national.slice(5)];
}

/**
 * How a number is shown: `091 123 4567` (national) or `+251 91 123 4567` (international).
 * Input that is not a valid Ethiopian number is returned unchanged, never guessed at.
 */
export function formatEthiopianPhone(input: string, style: PhoneStyle = "national"): string {
  const e164 = normalizeEthiopianPhone(input);
  if (!e164) return input;
  const [area, middle, last] = group(e164.slice(4));
  return style === "international"
    ? `+251 ${area} ${middle} ${last}`
    : `0${area} ${middle} ${last}`;
}

/** For lists and receipts: only the last four digits are readable (`091 ••• 4567`). */
export function maskEthiopianPhone(input: string, style: PhoneStyle = "national"): string {
  const e164 = normalizeEthiopianPhone(input);
  if (!e164) return "•••";
  const [area, , last] = group(e164.slice(4));
  return style === "international" ? `+251 ${area} ••• ${last}` : `0${area} ••• ${last}`;
}

export function isEthiopianE164(value: string): boolean {
  return E164.test(value);
}
