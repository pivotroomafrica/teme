import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccountsController } from './api/accounts.controller';
import { AuthController } from './api/auth.controller';
import { ActorLoader } from './application/actor-loader.service';
import { AccountsService } from './application/accounts.service';
import { AuthService } from './application/auth.service';
import { PasswordService } from './application/password.service';
import { TokenService } from './application/token.service';
import { IdentityRepository } from './infrastructure/identity.repository';
import { RefreshTokenRepository } from './infrastructure/refresh-token.repository';

@Module({
  imports: [JwtModule.register({})], // secret/issuer are supplied per call by TokenService
  controllers: [AuthController, AccountsController],
  providers: [
    AuthService,
    AccountsService,
    ActorLoader,
    PasswordService,
    TokenService,
    IdentityRepository,
    RefreshTokenRepository,
  ],
  exports: [ActorLoader, PasswordService, RefreshTokenRepository],
})
export class AuthModule {}
