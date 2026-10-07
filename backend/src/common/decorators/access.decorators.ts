import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'access:public';
export const PERMISSIONS_KEY = 'access:permissions';
export const AUTHENTICATED_ONLY_KEY = 'access:authenticated-only';

/** Route needs no authentication (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Route requires ALL listed permissions. Permissions prefixed `platform:` are satisfiable only by
 * platform administrators; all others only by merchant users.
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Any authenticated actor may call this route (e.g. "who am I"). Routes must declare one of
 * @Public, @Permissions or @AuthenticatedOnly: undeclared routes are denied (fail closed).
 */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
