import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { generateRequestId } from '../http/request-id';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.token',
  'req.body.cardToken',
  'req.headers["idempotency-key"]',
  'req.headers["x-api-key"]',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refresh_token',
  'req.body.pushToken',
  'req.body.phone',
  'req.body.firstName',
  '*.passwordHash',
  '*.tokenHash',
  '*.pushToken',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            genReqId: generateRequestId,
            redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
            autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
            customProps: () => ({ service: 'temelashcard-backend' }),
            transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
