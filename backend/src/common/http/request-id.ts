import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuse a well-formed inbound correlation ID, otherwise mint a UUID. Echoed on the response. */
export function generateRequestId(req: IncomingMessage, res: ServerResponse): string {
  const inbound = req.headers['x-request-id'];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const id = candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}
