import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/access.decorators';
import { DomainError } from '../../../../common/errors/domain-error';
import { ErrorCode } from '../../../../common/errors/error-codes';
import type { RequestWithActor } from '../../../tenancy';
import { ActorLoader } from '../../application/actor-loader.service';

const unauthenticated = () =>
  new DomainError(ErrorCode.UNAUTHENTICATED, 'Authentication required.', 401);

/** Global guard: every route is authenticated unless it is marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly actors: ActorLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & RequestWithActor>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthenticated();

    const actor = await this.actors.fromAccessToken(token);
    if (!actor) throw unauthenticated();
    req.actor = actor;
    return true;
  }
}
