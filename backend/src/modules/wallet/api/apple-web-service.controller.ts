import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/access.decorators';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { sanitizeError } from '../../jobs';
import { WalletProviders } from '../adapters/wallet-providers';
import { WalletService } from '../application/wallet.service';
import { WalletPassesRepository } from '../infrastructure/wallet-passes.repository';

class RegisterDeviceDto {
  @IsString()
  @MaxLength(256)
  pushToken!: string;
}

class LogDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  logs?: string[];
}

const unauthorized = () => new DomainError(ErrorCode.UNAUTHENTICATED, 'Unauthorized.', 401);
const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Not found.', 404);

/**
 * Apple's "Wallet web service". iPhones call these endpoints on their own (not our staff or customer
 * apps), authenticating each pass with `Authorization: ApplePass <token>`. The URL shapes are fixed by
 * Apple: https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes
 * Excluded from Swagger because it is not part of our public API.
 */
@ApiExcludeController()
@ApiTags('Apple Wallet web service')
@SkipThrottle()
@Controller('wallet/apple')
export class AppleWebServiceController {
  private readonly logger = new Logger(AppleWebServiceController.name);

  constructor(
    private readonly wallet: WalletService,
    private readonly passes: WalletPassesRepository,
    private readonly providers: WalletProviders,
  ) {}

  private assertPassType(passTypeId: string): void {
    if (!this.providers.isEnabled('APPLE') || passTypeId !== this.providers.applePassTypeId) {
      throw notFound();
    }
  }

  /** A device adds the pass and asks to be told about changes. 201 = new registration, 200 = existing. */
  @Public()
  @Post('v1/devices/:deviceId/registrations/:passTypeId/:serial')
  async register(
    @Param('deviceId') deviceId: string,
    @Param('passTypeId') passTypeId: string,
    @Param('serial', ParseUUIDPipe) serial: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: RegisterDeviceDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.assertPassType(passTypeId);
    const pass = await this.wallet.passForAppleAuth(serial, authorization);
    if (!pass) throw unauthorized();
    const created = await this.passes.upsertRegistration(
      pass,
      deviceId.slice(0, 128),
      dto.pushToken,
    );
    res.status(created ? 201 : 200);
  }

  @Public()
  @Delete('v1/devices/:deviceId/registrations/:passTypeId/:serial')
  @HttpCode(200)
  async unregister(
    @Param('deviceId') deviceId: string,
    @Param('passTypeId') passTypeId: string,
    @Param('serial', ParseUUIDPipe) serial: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    this.assertPassType(passTypeId);
    const pass = await this.wallet.passForAppleAuth(serial, authorization);
    if (!pass) throw unauthorized();
    await this.passes.removeRegistration(pass.id, deviceId.slice(0, 128));
  }

  /** Which of this device's passes changed since the tag it last saw? 204 when none. */
  @Public()
  @Get('v1/devices/:deviceId/registrations/:passTypeId')
  async changedSerials(
    @Param('deviceId') deviceId: string,
    @Param('passTypeId') passTypeId: string,
    @Query('passesUpdatedSince') since: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ serialNumbers: string[]; lastUpdated: string } | void> {
    this.assertPassType(passTypeId);
    const sinceDate = since && !Number.isNaN(Number(since)) ? new Date(Number(since)) : null;
    const rows = await this.passes.serialsForDevice(deviceId.slice(0, 128), sinceDate);
    if (rows.length === 0) {
      res.status(204);
      return;
    }
    const newest = Math.max(...rows.map((r) => r.updatedAt.getTime()));
    return { serialNumbers: rows.map((r) => r.serial), lastUpdated: String(newest) };
  }

  /** The latest version of a pass. 304 when the device already has it. */
  @Public()
  @Get('v1/passes/:passTypeId/:serial')
  async latestPass(
    @Param('passTypeId') passTypeId: string,
    @Param('serial', ParseUUIDPipe) serial: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-modified-since') ifModifiedSince: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | void> {
    this.assertPassType(passTypeId);
    const pass = await this.wallet.passForAppleAuth(serial, authorization);
    if (!pass) throw unauthorized();

    const since = ifModifiedSince ? Date.parse(ifModifiedSince) : NaN;
    if (
      !Number.isNaN(since) &&
      Math.floor(pass.updatedAt.getTime() / 1000) <= Math.floor(since / 1000)
    ) {
      res.status(304);
      return;
    }
    const rendered = await this.wallet.renderApplePass(pass);
    res.setHeader('Last-Modified', rendered.lastModified.toUTCString());
    // StreamableFile sends the bytes as-is (returning a Buffer would be serialised as JSON).
    return new StreamableFile(rendered.body, { type: rendered.contentType });
  }

  /** Devices report problems here. We keep a trimmed, scrubbed line for diagnostics and nothing else. */
  @Public()
  @Post('v1/log')
  @HttpCode(200)
  log(@Body() dto: LogDto): void {
    for (const line of (dto.logs ?? []).slice(0, 20)) {
      this.logger.warn(`Apple device log: ${sanitizeError(line, 300)}`);
    }
  }

  /** Short-lived signed link handed out by `POST /card/wallet/links`; opened by the phone's browser. */
  @Public()
  @Get('download/:serial')
  async download(
    @Param('serial', ParseUUIDPipe) serial: string,
    @Query('t') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pass = await this.wallet.passForDownload(serial, token ?? '');
    if (!pass) throw notFound();
    const rendered = await this.wallet.renderApplePass(pass);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(rendered.body, {
      type: rendered.contentType,
      disposition: 'attachment; filename="loyalty-card.pkpass"',
    });
  }
}
