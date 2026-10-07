import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

const nodeEnv = process.env.NODE_ENV ?? 'development';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Most specific file wins; real environment variables always win over files.
      envFilePath: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
      validate: validateEnv,
      cache: true,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
