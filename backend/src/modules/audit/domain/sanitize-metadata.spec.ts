/* eslint-disable @typescript-eslint/no-explicit-any */
import { sanitizeMetadata } from './sanitize-metadata';

describe('sanitizeMetadata', () => {
  it('redacts secrets, tokens, hashes and contact data at any depth', () => {
    const out = sanitizeMetadata({
      password: 'hunter2',
      refreshToken: 'abc',
      nested: { passwordHash: 'x', apiKey: 'k', authorization: 'Bearer z', keep: 'ok' },
      phoneE164: '+251911000000',
      email: 'a@b.test',
      from: 'STAFF',
      to: 'MANAGER',
    }) as Record<string, any>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.refreshToken).toBe('[REDACTED]');
    expect(out.nested.passwordHash).toBe('[REDACTED]');
    expect(out.nested.apiKey).toBe('[REDACTED]');
    expect(out.nested.authorization).toBe('[REDACTED]');
    expect(out.nested.keep).toBe('ok');
    expect(out.phoneE164).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.from).toBe('STAFF');
    expect(out.to).toBe('MANAGER');
  });

  it('truncates long strings and deep structures', () => {
    const long = 'x'.repeat(2000);
    expect((sanitizeMetadata({ note: long }) as any).note.length).toBeLessThan(600);
    const deep = { a: { b: { c: { d: { e: 'x' } } } } };
    expect(JSON.stringify(sanitizeMetadata(deep))).toContain('[truncated]');
  });

  it('serializes dates as ISO strings', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect((sanitizeMetadata({ at: d }) as any).at).toBe('2026-01-01T00:00:00.000Z');
  });
});
