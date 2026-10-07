import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

export function isLoginRequest(req: Pick<Request, 'method' | 'originalUrl' | 'url'>): boolean {
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
  return req.method === 'POST' && /\/auth\/login\/?$/.test(path);
}

const ENROLLMENT_PATH =
  /\/(join\/[^/]+\/enroll|card\/consent\/marketing\/withdraw|card\/wallet\/links|card\/web)\/?$/;

export function isEnrollmentRequest(req: Pick<Request, 'method' | 'originalUrl' | 'url'>): boolean {
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
  return req.method === 'POST' && ENROLLMENT_PATH.test(path);
}

/**
 * Tracks clients by IP. For login the key also includes the (normalised) email, so one attacker
 * cannot lock a victim out by exhausting the IP-wide budget, and one account is throttled per IP.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // Signature fixed by ThrottlerGuard.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip = String(req.ip ?? 'unknown');
    if (isLoginRequest(req as Request) && typeof req.body?.email === 'string') {
      return `${ip}|${req.body.email.trim().toLowerCase().slice(0, 254)}`;
    }
    return ip;
  }
}

/** skipIf helper: the strict "login" throttler applies to the login route only. */
export const skipUnlessLogin = (context: ExecutionContext): boolean =>
  !isLoginRequest(context.switchToHttp().getRequest<Request>());

/** skipIf helper: the strict "enroll" throttler applies to the public enrollment routes only. */
export const skipUnlessEnrollment = (context: ExecutionContext): boolean =>
  !isEnrollmentRequest(context.switchToHttp().getRequest<Request>());
