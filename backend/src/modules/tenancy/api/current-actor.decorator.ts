import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { Actor, MerchantActor, PlatformActor } from '../domain/actor';

export type RequestWithActor = { actor?: Actor };

function readActor(ctx: ExecutionContext): Actor {
  const actor = ctx.switchToHttp().getRequest<RequestWithActor>().actor;
  if (!actor) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Authentication required.', 401);
  return actor;
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor =>
  readActor(ctx),
);

/** Merchant context comes only from the authenticated principal, never from the request. */
export const CurrentMerchantActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): MerchantActor => {
    const actor = readActor(ctx);
    if (actor.kind !== 'merchant') {
      throw new DomainError(ErrorCode.FORBIDDEN, 'A merchant account is required.', 403);
    }
    return actor;
  },
);

export const CurrentPlatformActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformActor => {
    const actor = readActor(ctx);
    if (actor.kind !== 'platform') {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        'A platform administrator account is required.',
        403,
      );
    }
    return actor;
  },
);
