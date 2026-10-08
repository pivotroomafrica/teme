/**
 * Authenticated encryption for the session cookie (AES-256-GCM through Web Crypto, so it works in route
 * handlers and the proxy alike). The cookie holds the backend access and refresh tokens; sealing keeps them
 * unreadable and unforgeable even to the person who owns the browser.
 *
 * Format: "v1.<iv>.<ciphertext+tag>" (base64url). A wrong secret, a changed byte, or a malformed value all
 * make `unseal` return null; it never throws, so a bad cookie simply means "not signed in".
 */
const VERSION = "v1";
const INFO = "tc-session-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keys = new Map<string, Promise<CryptoKey>>();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function deriveKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = globalThis.crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        globalThis.crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: encoder.encode("temelashcard"),
            info: encoder.encode(INFO),
          },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    keys.set(secret, key);
  }
  return key;
}

export async function seal(payload: unknown, secret: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(VERSION) },
    await deriveKey(secret),
    encoder.encode(JSON.stringify(payload)),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

export async function unseal<T = unknown>(
  token: string | undefined,
  secret: string,
): Promise<T | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  try {
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parts[1]!), additionalData: encoder.encode(VERSION) },
      await deriveKey(secret),
      fromBase64Url(parts[2]!),
    );
    return JSON.parse(decoder.decode(plain)) as T;
  } catch {
    return null;
  }
}
