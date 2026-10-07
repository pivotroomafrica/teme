import { normalizeEthiopianPhone } from '../../../common/phone/ethiopian-phone';

export type ParsedCustomerQuery =
  | { kind: 'all' }
  | { kind: 'phone'; phone: string }
  | { kind: 'phone-partial'; digits: string }
  | { kind: 'name'; text: string }
  | { kind: 'invalid' };

const PHONE_CHARS = /^[+\d\s\-().]+$/;
const MIN_PARTIAL_DIGITS = 4;
const MIN_NAME_CHARS = 2;

/**
 * Interprets the free-text search box. A complete phone number is normalised (so "0911…", "+251 91…"
 * and "251911…" all find the same customer); a run of 4+ digits is a partial-phone search; otherwise
 * the text is a name search. SQL wildcard characters are stripped so "%" cannot list everyone.
 */
export function parseCustomerQuery(raw: string | undefined): ParsedCustomerQuery {
  const q = (raw ?? '').replace(/[%_\\]/g, '').trim();
  if (q === '') return { kind: 'all' };

  if (PHONE_CHARS.test(q)) {
    const phone = normalizeEthiopianPhone(q);
    if (phone) return { kind: 'phone', phone };
    const digits = q.replace(/\D/g, '');
    return digits.length >= MIN_PARTIAL_DIGITS
      ? { kind: 'phone-partial', digits }
      : { kind: 'invalid' };
  }
  return q.length >= MIN_NAME_CHARS ? { kind: 'name', text: q } : { kind: 'invalid' };
}

/** "+251911234567" -> "+2519*****567": enough to recognise, not enough to copy. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length <= 8) return '*'.repeat(phone.length);
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 8)}${phone.slice(-3)}`;
}
