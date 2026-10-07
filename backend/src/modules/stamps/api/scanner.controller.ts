import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { ScannerService } from '../application/scanner.service';
import { REJECTION_REASONS } from '../domain/scan-policy';

export class DeviceDto {
  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @Matches(/^[0-9A-Za-z._-]{1,20}$/)
  appVersion?: string;

  @ApiPropertyOptional({
    description: 'Opaque installation id (no hardware identifiers or personal data).',
  })
  @IsOptional()
  @Matches(/^[0-9A-Za-z._-]{1,64}$/)
  deviceId?: string;
}

export class ValidateScanDto {
  @ApiProperty({
    description: 'The opaque value read from the customer’s QR code / wallet barcode.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  cardToken!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Branch this device is operating at. Required unless the account is assigned to exactly one branch. Must be a branch the account may operate at.',
  })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}

export class ConfirmScanDto extends ValidateScanDto {
  @ApiPropertyOptional({ type: DeviceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

class MessageDto {
  @ApiProperty() en!: string;
  @ApiProperty() am!: string;
}

export class ScanResultDto {
  @ApiProperty({ enum: ['ELIGIBLE', 'STAMPED', 'REJECTED'] }) outcome!: string;
  @ApiProperty({ enum: REJECTION_REASONS, nullable: true }) reason!: string | null;
  @ApiProperty({ type: MessageDto, description: 'Safe text to show the operator.' })
  message!: MessageDto;
  @ApiPropertyOptional({ description: 'Seconds until another stamp is allowed (COOLDOWN_ACTIVE).' })
  retryAfterSeconds?: number;
  @ApiPropertyOptional() customer?: { firstName: string | null };
  @ApiPropertyOptional({
    description:
      'current/required/remaining on the card in progress, cards completed, rewards available.',
  })
  progress?: Record<string, number>;
  @ApiPropertyOptional() stamp?: { id: string; occurredAt: string };
  @ApiPropertyOptional() reward?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Validate only: the next stamp would complete the card.' })
  wouldUnlockReward?: boolean;
  @ApiProperty({
    description:
      'True when this is the stored answer to an earlier request with the same Idempotency-Key.',
  })
  replayed!: boolean;
}

@ApiTags('Scanner')
@ApiBearerAuth()
@Controller('scanner')
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @Permissions('stamp:create')
  @Post('validate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check whether a card can be stamped (no stamp is added)',
    description:
      'Read-only. Returns `ELIGIBLE` with progress, or `REJECTED` with a safe reason: BRANCH_NOT_PERMITTED, INVALID_TOKEN, ' +
      'MEMBERSHIP_INACTIVE, PROGRAM_INACTIVE or COOLDOWN_ACTIVE. Rejections are normal 200 results so a scanner UI can show ' +
      'them; protocol problems use the standard error envelope. The answer is advisory: confirmation re-checks under a lock.',
  })
  @ApiOkResponse({ type: ScanResultDto })
  validate(@CurrentMerchantActor() actor: MerchantActor, @Body() dto: ValidateScanDto) {
    return this.scanner.validate(actor, dto);
  }

  @Permissions('stamp:create')
  @Post('stamps')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Add one stamp to a card',
    description:
      'Exactly one stamp, atomically, or a safe rejection. Requires an `Idempotency-Key` header (one fresh key per scan ' +
      'attempt; reuse it only to retry that same attempt). A retry returns the original outcome with `replayed: true` and an ' +
      '`Idempotent-Replay: true` header and never adds a second stamp. Reusing a key for a different card or branch is 422. ' +
      'Reaching the program threshold unlocks a reward in the same transaction. The merchant is taken from your access token.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '8-128 URL-safe characters, e.g. a UUID.',
  })
  @ApiOkResponse({ type: ScanResultDto })
  @ApiUnprocessableEntityResponse({ description: 'IDEMPOTENCY_KEY_REUSED' })
  async confirm(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: ConfirmScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.scanner.confirm(actor, dto, idempotencyKey, meta);
    if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
    return result;
  }
}
