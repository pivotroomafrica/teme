import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '../../../../common/decorators/access.decorators';
import { DomainError } from '../../../../common/errors/domain-error';
import { ErrorCode } from '../../../../common/errors/error-codes';
import { actorHasPermission, type RequestWithActor } from '../../../tenancy';

/**
 * Global guard, runs after JwtAuthGuard. Fails closed: a route that declares neither
 * @Public, @AuthenticatedOnly nor @Permissions is denied, so a forgotten decorator cannot
 * silently expose an endpoint.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const actor = context.switchToHttp().getRequest<Request & RequestWithActor>().actor;
    if (!actor) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Authentication required.', 401);

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if (!required) {
      if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)) return true;
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} has no access declaration; denied.`,
      );
      throw new DomainError(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    }

    if (!required.every((permission) => actorHasPermission(actor, permission))) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'You do not have permission to do this.', 403);
    }
    return true;
  }
}
