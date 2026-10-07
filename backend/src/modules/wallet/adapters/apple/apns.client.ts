import * as http2 from 'node:http2';
import { WalletProviderError } from '../wallet-provider';

export interface PushResult {
  /** Tokens APNs accepted. */
  sent: string[];
  /** Tokens APNs says are no longer valid (410 / BadDeviceToken): the registration should be removed. */
  gone: string[];
  /** Tokens that failed for a reason that may pass (rate limit, outage). */
  retryable: Array<{ token: string; status: number; reason: string }>;
}

export interface PushSender {
  push(tokens: string[]): Promise<PushResult>;
}

export interface ApnsOptions {
  host: string;
  cert: string | Buffer;
  key: string | Buffer;
  passphrase?: string;
  /** The pass type identifier. */
  topic: string;
  requestTimeoutMs?: number;
  /** Test seam: replace http2.connect. */
  connect?: typeof http2.connect;
  /** Test seam: trust a local stand-in server's certificate. Never set in production. */
  tls?: { ca?: string | Buffer; rejectUnauthorized?: boolean };
}

/**
 * Sends the empty "something changed" push that makes iOS fetch the latest pass from our web service.
 * Authenticates with the pass-signing certificate (mutual TLS). Push tokens are secrets and are never
 * logged or put into error messages.
 */
export class ApnsClient implements PushSender {
  constructor(private readonly options: ApnsOptions) {}

  async push(tokens: string[]): Promise<PushResult> {
    const result: PushResult = { sent: [], gone: [], retryable: [] };
    if (tokens.length === 0) return result;

    const connect = this.options.connect ?? http2.connect;
    const session = connect(`https://${this.options.host}`, {
      cert: this.options.cert,
      key: this.options.key,
      passphrase: this.options.passphrase,
      ...this.options.tls,
    });
    const timeout = this.options.requestTimeoutMs ?? 10_000;

    try {
      await new Promise<void>((resolve, reject) => {
        session.once('error', () =>
          reject(new WalletProviderError('APNs connection failed', true, 'APNS_CONNECT')),
        );
        session.once('connect', () => resolve());
        // connect() may already be connected for test doubles.
        if (!session.connecting) resolve();
      });
      for (const token of tokens) {
        const { status, reason } = await this.send(session, token, timeout);
        if (status === 200) result.sent.push(token);
        else if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered')
          result.gone.push(token);
        else if (status === 429 || status >= 500) result.retryable.push({ token, status, reason });
        // other 4xx (bad topic, expired certificate...) are configuration problems: surface them
        else
          throw new WalletProviderError(
            `APNs rejected the push (${status} ${reason})`,
            false,
            'APNS_REJECTED',
          );
      }
    } finally {
      session.close();
    }
    return result;
  }

  private send(
    session: http2.ClientHttp2Session,
    token: string,
    timeoutMs: number,
  ): Promise<{ status: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(token)}`,
        'apns-topic': this.options.topic,
        'content-type': 'application/json',
      });
      let status = 0;
      let body = '';
      req.setTimeout(timeoutMs, () => {
        req.close();
        reject(new WalletProviderError('APNs request timed out', true, 'APNS_TIMEOUT'));
      });
      req.on('response', (headers) => {
        status = Number(headers[':status'] ?? 0);
      });
      req.setEncoding('utf8');
      req.on('data', (d: string) => (body += d));
      req.on('error', () =>
        reject(new WalletProviderError('APNs request failed', true, 'APNS_REQUEST')),
      );
      req.on('end', () => {
        let reason = '';
        try {
          reason = (JSON.parse(body || '{}') as { reason?: string }).reason ?? '';
        } catch {
          reason = '';
        }
        resolve({ status, reason });
      });
      req.end('{}');
    });
  }
}
