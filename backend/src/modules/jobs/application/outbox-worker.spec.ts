import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type { ClaimedJob, OutboxRepository } from '../infrastructure/outbox.repository';
import { OutboxHandlerRegistry, PermanentJobError } from './outbox-handler.registry';
import { OutboxWorker } from './outbox-worker.service';

const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: 'j1',
  merchantId: 'm1',
  type: 'test.job',
  aggregateType: 'x',
  aggregateId: 'a',
  payload: {},
  attempts: 1,
  maxAttempts: 3,
  ...over,
});

function setup(jobs: ClaimedJob[], enabled = true) {
  const repo = {
    claimDue: jest.fn().mockResolvedValueOnce(jobs).mockResolvedValue([]),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markRetry: jest.fn().mockResolvedValue(undefined),
    markDead: jest.fn().mockResolvedValue(undefined),
  };
  const registry = new OutboxHandlerRegistry();
  const config = {
    get: (k: string) =>
      ({ OUTBOX_WORKER_ENABLED: enabled, OUTBOX_POLL_INTERVAL_MS: 100, OUTBOX_BATCH_SIZE: 5 })[k],
  } as unknown as ConfigService<Env, true>;
  const worker = new OutboxWorker(repo as unknown as OutboxRepository, registry, config);
  return { repo, registry, worker };
}

describe('OutboxHandlerRegistry', () => {
  it('refuses two handlers for one job type', () => {
    const r = new OutboxHandlerRegistry();
    r.register('a', { handle: async () => undefined });
    expect(() => r.register('a', { handle: async () => undefined })).toThrow(/already registered/);
    expect(r.get('missing')).toBeUndefined();
  });
});

describe('OutboxWorker', () => {
  it('completes jobs whose handler succeeds', async () => {
    const { repo, registry, worker } = setup([job()]);
    const handle = jest.fn().mockResolvedValue(undefined);
    registry.register('test.job', { handle });
    expect(await worker.processBatch()).toEqual({ claimed: 1, completed: 1, retried: 0, dead: 0 });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' }));
    expect(repo.markCompleted).toHaveBeenCalledWith('j1');
  });

  it('retries a failure with a scrubbed error and a future run time', async () => {
    const { repo, registry, worker } = setup([job()]);
    registry.register('test.job', {
      handle: async () => {
        throw new Error('boom Bearer abcdefghijklmnop');
      },
    });
    const before = Date.now();
    expect(await worker.processBatch()).toMatchObject({ retried: 1, dead: 0 });
    const [id, when, message] = repo.markRetry.mock.calls[0] as [string, Date, string];
    expect(id).toBe('j1');
    expect(when.getTime()).toBeGreaterThan(before + 20_000);
    expect(message).not.toContain('abcdefghijklmnop');
  });

  it('dead-letters when the attempt budget is spent', async () => {
    const { repo, registry, worker } = setup([job({ attempts: 3, maxAttempts: 3 })]);
    registry.register('test.job', {
      handle: async () => {
        throw new Error('still broken');
      },
    });
    expect(await worker.processBatch()).toMatchObject({ retried: 0, dead: 1 });
    expect(repo.markDead).toHaveBeenCalledWith('j1', 'still broken');
  });

  it('dead-letters permanent failures and unhandled types on the first attempt', async () => {
    const { repo, registry, worker } = setup([
      job({ id: 'p' }),
      job({ id: 'u', type: 'nobody.handles.this' }),
    ]);
    registry.register('test.job', {
      handle: async () => {
        throw new PermanentJobError('never going to work');
      },
    });
    expect(await worker.processBatch()).toMatchObject({ claimed: 2, dead: 2 });
    expect(repo.markDead).toHaveBeenCalledWith('p', 'never going to work');
    expect(repo.markDead.mock.calls[1]?.[1]).toContain('No handler registered');
  });

  it('keeps going after one job fails', async () => {
    const { registry, worker } = setup([job({ id: 'bad' }), job({ id: 'good', type: 'ok.job' })]);
    registry.register('test.job', {
      handle: async () => {
        throw new Error('x');
      },
    });
    const ok = jest.fn().mockResolvedValue(undefined);
    registry.register('ok.job', { handle: ok });
    expect(await worker.processBatch()).toMatchObject({ completed: 1, retried: 1 });
    expect(ok).toHaveBeenCalled();
  });

  it('does not poll when disabled, and polls then stops cleanly when enabled', async () => {
    const off = setup([], false);
    off.worker.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 150));
    expect(off.repo.claimDue).not.toHaveBeenCalled();
    await off.worker.onApplicationShutdown();

    const on = setup([]);
    on.worker.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 250));
    expect(on.repo.claimDue.mock.calls.length).toBeGreaterThanOrEqual(1);
    await on.worker.onApplicationShutdown();
    const calls = on.repo.claimDue.mock.calls.length;
    await new Promise((r) => setTimeout(r, 250));
    expect(on.repo.claimDue.mock.calls.length).toBe(calls); // stopped
  });
});
