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
import { RedemptionService } from '../application/redemption.service';

class DeviceDto {
  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9A-Za-z._-]{1,20}$/) appVersion?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9A-Za-z._-]{1,64}$/) deviceId?: string;
}

export class RewardLookupDto {
  @ApiProperty({
    description: 'The opaque value read from the customer’s QR code / wallet barcode.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  cardToken!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Branch this device operates at (optional for single-branch staff).',
  })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;
}

export class RedeemDto extends RewardLookupDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Which reward to redeem. Omit to redeem the soonest-expiring available reward.',
  })
  @IsOptional()
  @IsUUID('4')
  rewardUnlockId?: string;

  @ApiPropertyOptional({ type: DeviceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

class RedeemResultDto {
  @ApiProperty({ enum: ['AVAILABLE', 'REDEEMED', 'REJECTED'] }) outcome!: string;
  @ApiProperty({
    nullable: true,
    description:
      'BRANCH_NOT_PERMITTED, INVALID_TOKEN, MEMBERSHIP_INACTIVE, NO_REWARD_AVAILABLE or REWARD_NOT_AVAILABLE.',
  })
  reason!: string | null;
  @ApiProperty() message!: { en: string; am: string };
  @ApiPropertyOptional() customer?: { firstName: string | null };
  @ApiPropertyOptional({
    description: 'Lookup: rewards that can be redeemed now, soonest-expiring first.',
  })
  rewards?: Array<Record<string, unknown>>;
  @ApiPropertyOptional() reward?: Record<string, unknown>;
  @ApiPropertyOptional() redemption?: { id: string; occurredAt: string };
  @ApiPropertyOptional() progress?: Record<string, number>;
  @ApiProperty() replayed!: boolean;
}

@ApiTags('Scanner')
@ApiBearerAuth()
@Controller('scanner')
export class RedemptionsController {
  constructor(private readonly redemptions: RedemptionService) {}

  @Permissions('redemption:create')
  @Post('rewards/lookup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'List the rewards a card can redeem right now (nothing is redeemed)',
    description:
      'Read-only. `AVAILABLE` with the rewards, or `REJECTED` with a safe reason (e.g. NO_REWARD_AVAILABLE).',
  })
  @ApiOkResponse({ type: RedeemResultDto })
  lookup(@CurrentMerchantActor() actor: MerchantActor, @Body() dto: RewardLookupDto) {
    return this.redemptions.lookup(actor, dto);
  }

  @Permissions('redemption:create')
  @Post('redemptions')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Redeem one reward',
    description:
      'Hands over exactly one available reward, atomically. Only staff who may operate at the branch can redeem. Requires an ' +
      '`Idempotency-Key`; a retry returns the original outcome (`replayed: true`). Two devices redeeming the same reward at the ' +
      'same moment cannot both succeed: one gets REWARD_NOT_AVAILABLE or NO_REWARD_AVAILABLE. Earned rewards can be redeemed while ' +
      'the program is paused or archived. A wallet update is queued in the same transaction.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: RedeemResultDto })
  @ApiUnprocessableEntityResponse({ description: 'IDEMPOTENCY_KEY_REUSED' })
  async redeem(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: RedeemDto,
    @Headers('idempotency-key') key: string | undefined,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.redemptions.redeem(actor, dto, key, meta);
    if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
    return result;
  }
}
