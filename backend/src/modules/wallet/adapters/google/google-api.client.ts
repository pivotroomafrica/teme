import { signJwtRs256 } from '../../../../common/crypto/jwt-rs256';
import { WalletProviderError } from '../wallet-provider';
import type { GoogleConfig } from './google-config';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const REQUEST_TIMEOUT_MS = 15_000;

/** The calls the adapter needs; implemented over REST below and over a recorder in tests. */
export interface GoogleWalletApi {
  getClass(id: string): Promise<Record<string, unknown> | null>;
  insertClass(body: Record<string, unknown>): Promise<void>;
  patchClass(id: string, body: Record<string, unknown>): Promise<void>;
  getObject(id: string): Promise<Record<string, unknown> | null>;
  insertObject(body: Record<string, unknown>): Promise<void>;
  patchObject(id: string, body: Record<string, unknown>): Promise<'ok' | 'missing'>;
}

/**
 * Google Wallet REST client authenticated as a service account (OAuth 2.0 JWT bearer grant). The
 * private key only ever signs the assertion; the key, assertion and access token are never logged
 * and never appear in thrown errors.
 */
export class GoogleWalletRestApi implements GoogleWalletApi {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly config: GoogleConfig,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init) as ReturnType<FetchLike>,
  ) {}

  getClass(id: string) {
    return this.getJson(`/walletobjects/v1/loyaltyClass/${encodeURIComponent(id)}`);
  }
  async insertClass(body: Record<string, unknown>) {
    await this.call('POST', '/walletobjects/v1/loyaltyClass', body, [409]);
  }
  async patchClass(id: string, body: Record<string, unknown>) {
    await this.call('PATCH', `/walletobjects/v1/loyaltyClass/${encodeURIComponent(id)}`, body);
  }
  getObject(id: string) {
    return this.getJson(`/walletobjects/v1/loyaltyObject/${encodeURIComponent(id)}`);
  }
  async insertObject(body: Record<string, unknown>) {
    await this.call('POST', '/walletobjects/v1/loyaltyObject', body, [409]);
  }
  async patchObject(id: string, body: Record<string, unknown>): Promise<'ok' | 'missing'> {
    const res = await this.call(
      'PATCH',
      `/walletobjects/v1/loyaltyObject/${encodeURIComponent(id)}`,
      body,
      [404],
    );
    return res.status === 404 ? 'missing' : 'ok';
  }

  private async getJson(path: string): Promise<Record<string, unknown> | null> {
    const res = await this.call('GET', path, undefined, [404]);
    if (res.status === 404) return null;
    try {
      return JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      throw new WalletProviderError(
        'Google returned an unreadable response',
        true,
        'GOOGLE_BAD_RESPONSE',
      );
    }
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwtRs256(
      {
        iss: this.config.clientEmail,
        scope: SCOPE,
        aud: this.config.tokenUrl,
        iat: now,
        exp: now + 3600,
      },
      this.config.privateKey,
    );
    const res = await this.raw(
      this.config.tokenUrl,
      'POST',
      {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    );
    if (res.status !== 200) {
      // 5xx/429 may pass; 400/401 means the credentials themselves are rejected.
      throw new WalletProviderError(
        `Google rejected the service-account sign-in (HTTP ${res.status})`,
        res.status >= 500 || res.status === 429,
        'GOOGLE_AUTH',
      );
    }
    try {
      const json = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new Error('no token');
      this.token = {
        value: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      };
      return json.access_token;
    } catch {
      throw new WalletProviderError(
        'Google returned an unreadable sign-in response',
        true,
        'GOOGLE_AUTH',
      );
    }
  }

  /** Authenticated call. Statuses in `accept` are returned instead of thrown. */
  private async call(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    accept: number[] = [],
  ): Promise<{ status: number; body: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt > 0);
      const res = await this.raw(
        `${this.config.apiBase}${path}`,
        method,
        { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body ? JSON.stringify(body) : undefined,
      );
      if (res.status === 401 && attempt === 0) continue; // token expired early: refresh once
      if (res.status >= 200 && res.status < 300) return res;
      if (accept.includes(res.status)) return res;
      throw new WalletProviderError(
        `Google Wallet API ${method} failed (HTTP ${res.status})`,
        res.status === 429 || res.status >= 500 || res.status === 401,
        `GOOGLE_HTTP_${res.status}`,
      );
    }
    throw new WalletProviderError('Google Wallet API authorisation failed', false, 'GOOGLE_AUTH');
  }

  private async raw(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, { method, headers, body, signal: controller.signal });
      return { status: res.status, body: await res.text() };
    } catch {
      // Network failure or timeout: say so without the URL (it can contain identifiers) or any detail.
      throw new WalletProviderError('Could not reach Google Wallet', true, 'GOOGLE_NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }
}
