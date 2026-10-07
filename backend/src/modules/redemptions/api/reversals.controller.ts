import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { MembershipLedgerService } from '../application/membership-ledger.service';
import { ReversalService } from '../application/reversal.service';

export class ReverseDto {
  @ApiProperty({
    description:
      'Why this is being reversed (3-500 characters). Mandatory. Kept with the reversal record, not in the audit log.',
  })
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

class ReversalResultDto {
  @ApiProperty({ format: 'uuid' }) reversalId!: string;
  @ApiProperty({ enum: ['STAMP', 'REDEMPTION'] }) target!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ description: 'Progress and available rewards after the reversal.' })
  progress!: Record<string, number>;
  @ApiProperty() replayed!: boolean;
}

@ApiTags('Reversals')
@ApiBearerAuth()
@Controller('merchant')
export class ReversalsController {
  constructor(private readonly reversals: ReversalService) {}

  @Permissions('reversal:create')
  @Post('stamps/:stampId/reverse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reverse a stamp (owners and authorised managers)',
    description:
      'Appends a compensating event; the original stamp is never changed. A reason is mandatory and an `Idempotency-Key` is ' +
      'required. Progress and rewards are re-derived from the ledger. Refused with REWARD_ALREADY_REDEEMED when it would leave a ' +
      'redeemed reward without stamps behind it (reverse the redemption first), and with ALREADY_REVERSED on a second attempt.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ReversalResultDto })
  @ApiForbiddenResponse({ description: 'Requires reversal:create' })
  @ApiNotFoundResponse({ description: 'Unknown or other-tenant stamp' })
  @ApiConflictResponse({ description: 'ALREADY_REVERSED or REWARD_ALREADY_REDEEMED' })
  async reverseStamp(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('stampId', ParseUUIDPipe) stampId: string,
    @Body() dto: ReverseDto,
    @Headers('idempotency-key') key: string | undefined,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reversals.reverseStamp(actor, stampId, dto.reason, key, meta);
    if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
    return result;
  }

  @Permissions('reversal:create')
  @Post('redemptions/:redemptionId/reverse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reverse a redemption (owners and authorised managers)',
    description:
      'Appends a compensating event; the reward becomes available again if it is still backed by stamps and unexpired. Reason and `Idempotency-Key` required.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: ReversalResultDto })
  @ApiConflictResponse({ description: 'ALREADY_REVERSED' })
  async reverseRedemption(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('redemptionId', ParseUUIDPipe) redemptionId: string,
    @Body() dto: ReverseDto,
    @Headers('idempotency-key') key: string | undefined,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reversals.reverseRedemption(
      actor,
      redemptionId,
      dto.reason,
      key,
      meta,
    );
    if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
    return result;
  }
}

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('merchant/memberships')
export class MembershipLedgerController {
  constructor(private readonly ledger: MembershipLedgerService) {}

  @Permissions('customer:read')
  @Get(':membershipId/rewards')
  @ApiOperation({
    summary: 'Progress and the state of every reward of a membership',
    description: 'States are derived from the ledger: AVAILABLE, REDEEMED, EXPIRED or REVERSED.',
  })
  @ApiNotFoundResponse()
  summary(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.ledger.summary(actor, membershipId);
  }

  @Permissions('reversal:create')
  @Get(':membershipId/ledger')
  @ApiOperation({
    summary: 'The append-only ledger of a membership (owners and authorised managers)',
    description:
      'Newest first: stamps, redemptions and reversals with their reasons. Capped at 200 entries per type.',
  })
  @ApiNotFoundResponse()
  entries(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.ledger.ledger(actor, membershipId);
  }
}
