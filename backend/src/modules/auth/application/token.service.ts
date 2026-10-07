import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../../config/env.schema';

export interface AccessClaims {
  sub: string;
  typ: 'platform' | 'merchant';
  /** Staff membership id (merchant tokens only). Cross-checked against the database. */
  sid?: string;
  /** Merchant id (merchant tokens only). Cross-checked against the database. */
  mid?: string;
  use: 'access';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  get refreshTtlMs(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  signAccessToken(claims: Omit<AccessClaims, 'use'>): Promise<string> {
    return this.jwt.signAsync(
      { ...claims, use: 'access' },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        issuer: this.config.get('JWT_ISSUER', { infer: true }),
        algorithm: 'HS256',
        expiresIn: this.accessTtlSeconds,
      },
    );
  }

  /** Throws on bad signature, wrong algorithm, wrong issuer or expiry. */
  async verifyAccessToken(token: string): Promise<AccessClaims> {
    const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      issuer: this.config.get('JWT_ISSUER', { infer: true }),
      algorithms: ['HS256'],
    });
    if (
      claims.use !== 'access' ||
      !claims.sub ||
      (claims.typ !== 'platform' && claims.typ !== 'merchant')
    ) {
      throw new Error('not an access token');
    }
    return claims;
  }

  /** 256 bits of randomness; only the SHA-256 hash is persisted. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
