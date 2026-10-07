import { createVerify, generateKeyPairSync } from 'node:crypto';
import { signJwtRs256 } from './jwt-rs256';

describe('signJwtRs256', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  it('produces a verifiable three-part token with the requested claims', () => {
    const jwt = signJwtRs256({ iss: 'svc@example.test', n: 1 }, privateKey, { kid: 'k1' });
    const [h, p, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'k1',
    });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({
      iss: 'svc@example.test',
      n: 1,
    });
    expect(
      createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')),
    ).toBe(true);
  });

  it('fails verification when the payload is altered', () => {
    const [h, , s] = signJwtRs256({ a: 1 }, privateKey).split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ a: 2 })).toString('base64url');
    expect(
      createVerify('RSA-SHA256')
        .update(`${h}.${forged}`)
        .verify(publicKey, Buffer.from(s, 'base64url')),
    ).toBe(false);
  });

  it('throws on an invalid key without echoing it', () => {
    expect(() => signJwtRs256({}, 'not a key')).toThrow();
  });
});
