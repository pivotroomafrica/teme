import { createSign } from 'node:crypto';

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** Signs a JWT with RS256 using a PEM private key (used for Google service-account assertions and links). */
export function signJwtRs256(
  claims: Record<string, unknown>,
  privateKeyPem: string,
  header: Record<string, unknown> = {},
): string {
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header }))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(input).sign(privateKeyPem);
  return `${input}.${b64url(signature)}`;
}
