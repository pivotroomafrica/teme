import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import {
  AppThrottlerGuard,
  skipUnlessEnrollment,
  skipUnlessLogin,
} from './common/http/app-throttler.guard';
import { AppLoggerModule } from './common/logging/logger.module';
import { AppConfigModule } from './config/app-config.module';
import type { Env } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { AnalyticsModule } from './modules/analytics';
import { AuditModule } from './modules/audit';
import { AuditViewerModule } from './modules/audit-viewer';
import { AuthModule, JwtAuthGuard, PermissionsGuard } from './modules/auth';
import { BranchesModule } from './modules/branches';
import { CustomersModule } from './modules/customers';
import { FraudModule } from './modules/fraud';
import { PrivacyModule } from './modules/privacy';
import { HealthModule } from './modules/health';
import { JobsModule } from './modules/jobs';
import { LoyaltyProgramsModule } from './modules/loyalty-programs';
import { MembershipsModule } from './modules/memberships';
import { RedemptionsModule } from './modules/redemptions';
import { RewardsModule } from './modules/rewards';
import { StampsModule } from './modules/stamps';
import { WalletModule } from './modules/wallet';
import { MerchantsModule } from './modules/merchants';
import { StaffModule } from './modules/staff';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          name: 'default',
          ttl: config.get('RATE_LIMIT_TTL_SECONDS', { infer: true }) * 1000,
          limit: config.get('RATE_LIMIT_MAX', { infer: true }),
        },
        {
          // Strict budget for POST /auth/login only, keyed by IP + email.
          name: 'login',
          ttl: config.get('LOGIN_RATE_LIMIT_TTL_SECONDS', { infer: true }) * 1000,
          limit: config.get('LOGIN_RATE_LIMIT_MAX', { infer: true }),
          skipIf: skipUnlessLogin,
        },
        {
          // Public enrollment / consent-withdrawal routes: per-IP budget against enumeration and spam.
          name: 'enroll',
          ttl: config.get('ENROLL_RATE_LIMIT_TTL_SECONDS', { infer: true }) * 1000,
          limit: config.get('ENROLL_RATE_LIMIT_MAX', { infer: true }),
          skipIf: skipUnlessEnrollment,
        },
      ],
    }),
    DatabaseModule,
    AuditModule,
    AuditViewerModule,
    JobsModule,
    AuthModule,
    HealthModule,
    MerchantsModule,
    BranchesModule,
    StaffModule,
    LoyaltyProgramsModule,
    CustomersModule,
    MembershipsModule,
    RewardsModule,
    StampsModule,
    RedemptionsModule,
    WalletModule,
    FraudModule,
    PrivacyModule,
    AnalyticsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: rate limit, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
