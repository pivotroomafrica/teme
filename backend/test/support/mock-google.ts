import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { createVerify } from 'node:crypto';
import type { TestGoogleCredentials } from './wallet-credentials';

/** A tiny stand-in for Google's OAuth endpoint and Wallet Objects REST API. */
export class MockGoogle {
  readonly classes = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  readonly objects = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  readonly requests: Array<{ method: string; url: string; auth: string | undefined }> = [];
  tokenCalls = 0;
  /** Next N API calls answer with this status instead of working. */
  failWith: { status: number; times: number } | null = null;
  rejectAuth = false;
  expireTokenOnce = false;
  private server!: Server;
  url = '';

  constructor(private readonly creds: TestGoogleCredentials) {}

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  private async body(req: IncomingMessage): Promise<string> {
    let b = '';
    for await (const chunk of req) b += chunk;
    return b;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const raw = await this.body(req);
    const send = (status: number, json: unknown = {}) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const url = req.url ?? '';

    if (url === '/token') {
      this.tokenCalls++;
      if (this.rejectAuth) return send(401, { error: 'invalid_grant' });
      const assertion = new URLSearchParams(raw).get('assertion') ?? '';
      const [h, p, s] = assertion.split('.');
      const ok = createVerify('RSA-SHA256')
        .update(`${h}.${p}`)
        .verify(this.creds.publicKey, Buffer.from(s ?? '', 'base64url'));
      const claims = JSON.parse(Buffer.from(p ?? '', 'base64url').toString() || '{}');
      if (
        !ok ||
        claims.iss !== this.creds.clientEmail ||
        claims.scope !== 'https://www.googleapis.com/auth/wallet_object.issuer'
      ) {
        return send(400, { error: 'invalid_grant' });
      }
      return send(200, { access_token: `tok-${this.tokenCalls}`, expires_in: 3600 });
    }

    const auth = req.headers.authorization;
    this.requests.push({ method: req.method ?? '', url, auth });
    if (this.expireTokenOnce && auth === 'Bearer tok-1') {
      this.expireTokenOnce = false;
      return send(401);
    }
    if (!auth?.startsWith('Bearer tok-')) return send(401);
    if (this.failWith && this.failWith.times > 0) {
      this.failWith.times--;
      return send(this.failWith.status, {
        error: { message: 'boom with secret ' + this.creds.privateKey.slice(0, 40) },
      });
    }

    const m = /^\/walletobjects\/v1\/(loyaltyClass|loyaltyObject)(?:\/(.+))?$/.exec(url);
    if (!m) return send(404);
    const store = m[1] === 'loyaltyClass' ? this.classes : this.objects;
    const id = m[2] ? decodeURIComponent(m[2]) : undefined;
    const data = raw ? JSON.parse(raw) : undefined;

    if (req.method === 'POST' && !id) {
      if (store.has(data.id)) return send(409);
      store.set(data.id, data);
      return send(200, data);
    }
    if (!id || !store.has(id)) return send(404);
    if (req.method === 'GET') return send(200, store.get(id));
    if (req.method === 'PATCH') {
      store.set(id, { ...store.get(id), ...data });
      return send(200, store.get(id));
    }
    return send(405);
  }
}
