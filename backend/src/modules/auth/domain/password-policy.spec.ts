import { checkPassword } from './password-policy';

describe('checkPassword', () => {
  it('accepts a long password with letters and digits', () => {
    expect(checkPassword('Correct-Horse-Battery-9')).toBeNull();
    expect(checkPassword('አማርኛ-ይለፍ-ቃል-12345')).toBeNull();
  });
  it('rejects short, oversized, letter-only and digit-only passwords', () => {
    expect(checkPassword('Short1')).toMatch(/at least 12/);
    expect(checkPassword('a1'.repeat(70))).toMatch(/at most 128/);
    expect(checkPassword('onlylettersonlyletters')).toMatch(/letter and one digit/);
    expect(checkPassword('123456789012345')).toMatch(/letter and one digit/);
  });
  it('rejects passwords containing the email name', () => {
    expect(checkPassword('maria-Secret-2026', 'maria@cafe.test')).toMatch(/email name/);
    expect(checkPassword('Secret-2026-xyz', 'maria@cafe.test')).toBeNull();
  });
});
