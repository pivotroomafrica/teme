import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { AnonymizationService } from '../application/anonymization.service';
import { CustomerDataService } from '../application/customer-data.service';
import { RetentionService } from '../application/retention.service';
import { ANONYMIZATION_REASONS, type AnonymizationReason } from '../domain/customer-export';
import {
  MAX_INACTIVE_MONTHS,
  MIN_INACTIVE_MONTHS,
  isValidInactiveMonths,
} from '../domain/retention-policy';

export class AnonymizeCustomerDto {
  @ApiProperty({
    enum: ANONYMIZATION_REASONS,
    description: 'Why. A fixed list, so the audit log never holds free text about a person.',
  })
  @IsIn(ANONYMIZATION_REASONS as unknown as string[])
  reason!: AnonymizationReason;

  @ApiPropertyOptional({
    default: false,
    description: 'Required when the customer still has unclaimed rewards, which are forfeited.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeOutstandingRewards?: boolean;
}

export class RetentionPolicyDto {
  @ApiProperty({
    minimum: 0,
    maximum: MAX_INACTIVE_MONTHS,
    description: `Anonymize customers with no stamp or redemption for this many months (${MIN_INACTIVE_MONTHS}-${MAX_INACTIVE_MONTHS}). 0 turns automatic anonymization off.`,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_INACTIVE_MONTHS)
  inactiveCustomerMonths!: number;
}

@ApiTags('Privacy')
@ApiBearerAuth()
@Controller('merchant')
export class PrivacyController {
  constructor(
    private readonly data: CustomerDataService,
    private readonly anonymization: AnonymizationService,
    private readonly retention: RetentionService,
  ) {}

  @Permissions('privacy:manage')
  @Get('customers/:customerId/data')
  @ApiOperation({
    summary: 'View everything stored about a customer',
    description:
      'Profile, consent history, memberships, wallet passes and the full stamp/redemption/reversal history. The access is recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'The customer data, in the same shape as the export.' })
  @ApiNotFoundResponse({ description: 'No such customer at this merchant.' })
  @ApiForbiddenResponse({ description: 'Requires privacy:manage (owners).' })
  view(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.data.view(actor, customerId, meta);
  }

  @Permissions('privacy:manage')
  @Get('customers/:customerId/export')
  @ApiOperation({
    summary: 'Download a portable copy of a customer’s data (JSON file)',
    description: 'Same content as the view, delivered as an attachment. Recorded in the audit log.',
  })
  @ApiOkResponse({ description: 'A JSON attachment.' })
  @ApiNotFoundResponse({ description: 'No such customer at this merchant.' })
  async export(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.data.export(actor, customerId, meta);
    res.setHeader('Content-Disposition', `attachment; filename="customer-${customerId}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }

  @Permissions('privacy:manage')
  @Post('customers/:customerId/anonymize')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Anonymize a customer (irreversible)',
    description:
      'Removes name and phone number, closes every card and revokes wallet passes. Stamp, redemption and audit history stays but no longer points to a person. Repeating the call is harmless.',
  })
  @ApiOkResponse({ description: '{ customerId, anonymized, membershipsClosed }' })
  @ApiConflictResponse({
    description: 'REWARDS_OUTSTANDING: the customer has unclaimed rewards and no acknowledgement.',
  })
  @ApiNotFoundResponse({ description: 'No such customer at this merchant.' })
  anonymize(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AnonymizeCustomerDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.anonymization.forActor(
      actor,
      customerId,
      {
        reason: dto.reason,
        acknowledgeOutstandingRewards: dto.acknowledgeOutstandingRewards ?? false,
      },
      meta,
    );
  }

  @Permissions('privacy:manage')
  @Get('privacy/retention')
  @ApiOperation({ summary: 'Current retention period' })
  @ApiOkResponse({ type: RetentionPolicyDto })
  getRetention(@CurrentMerchantActor() actor: MerchantActor) {
    return this.retention.get(actor.merchantId);
  }

  @Permissions('privacy:manage')
  @Put('privacy/retention')
  @ApiOperation({ summary: 'Set the retention period' })
  @ApiOkResponse({ type: RetentionPolicyDto })
  async setRetention(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: RetentionPolicyDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    if (!isValidInactiveMonths(dto.inactiveCustomerMonths)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `inactiveCustomerMonths must be 0 (off) or between ${MIN_INACTIVE_MONTHS} and ${MAX_INACTIVE_MONTHS}.`,
        422,
      );
    }
    return this.retention.update(
      actor,
      { inactiveCustomerMonths: dto.inactiveCustomerMonths },
      meta,
    );
  }

  @Permissions('privacy:manage')
  @Post('privacy/retention/run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Apply the retention period now',
    description:
      'Anonymizes up to 200 inactive customers without an unclaimed reward. `more` says whether to call again.',
  })
  @ApiOkResponse({ description: '{ anonymized, more }' })
  runRetention(@CurrentMerchantActor() actor: MerchantActor, @ReqMeta() meta: RequestMeta) {
    return this.retention.runForMerchant(actor.merchantId, {
      actorUserId: actor.userId,
      requestId: meta.requestId,
    });
  }
}
