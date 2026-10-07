import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateRequestId } from './request-id';

function run(header?: string) {
  const headers: Record<string, string> = {};
  const req = { headers: header ? { 'x-request-id': header } : {} } as unknown as IncomingMessage;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as ServerResponse;
  return { id: generateRequestId(req, res), headers };
}

describe('generateRequestId', () => {
  it('mints a UUID when no header is supplied and echoes it', () => {
    const { id, headers } = run();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['x-request-id']).toBe(id);
  });

  it('reuses a well-formed inbound id', () => {
    expect(run('abc-12345678').id).toBe('abc-12345678');
  });

  it('replaces a malformed inbound id', () => {
    const { id } = run('bad id with spaces\n');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
