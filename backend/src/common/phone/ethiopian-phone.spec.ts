import { E164_ETHIOPIA, normalizeEthiopianPhone } from './ethiopian-phone';

describe('normalizeEthiopianPhone', () => {
  it.each([
    ['0911234567', '+251911234567'],
    ['911234567', '+251911234567'],
    ['251911234567', '+251911234567'],
    ['+251911234567', '+251911234567'],
    ['00251911234567', '+251911234567'],
    ['+251 91 123 4567', '+251911234567'],
    ['(0911) 234-567', '+251911234567'],
    ['0711234567', '+251711234567'],
    ['0111234567', '+251111234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toBe(expected);
    expect(expected).toMatch(E164_ETHIOPIA);
  });

  it.each([
    '',
    '   ',
    '091123456', // too short
    '09112345678', // too long
    '+254911234567', // Kenya
    '+12025550123', // US
    '0611234567', // invalid leading digit
    '0811234567', // invalid leading digit
    'abc',
    '+251-9x1234567',
  ])('rejects %p', (input) => {
    expect(normalizeEthiopianPhone(input)).toBeNull();
  });

  it('is idempotent on its own output', () => {
    const once = normalizeEthiopianPhone('0911234567');
    expect(normalizeEthiopianPhone(once as string)).toBe(once);
  });
});
