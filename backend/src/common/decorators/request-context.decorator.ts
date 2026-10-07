import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestMeta {
  requestId: string;
  ip: string | undefined;
  userAgent: string | undefined;
}

/** Correlation and client details for audit trails. Values are length-limited. */
export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request & { id?: string | number }>();
  const ua = req.headers['user-agent'];
  return {
    requestId: String(req.id ?? 'unknown'),
    ip: req.ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 200) : undefined,
  };
});
