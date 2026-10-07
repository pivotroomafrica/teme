import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { PageQueryDto } from '../../../common/http/pagination';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { FraudEvaluationService } from '../application/fraud-evaluation.service';
import { FraudFlagsService } from '../application/fraud-flags.service';
import { FRAUD_INDICATORS } from '../domain/fraud-types';
import { THRESHOLD_LIMITS } from '../domain/fraud-thresholds';

const INDICATORS = FRAUD_INDICATORS;

const L = THRESHOLD_LIMITS;

export class FlagQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'DISMISSED', 'CONFIRMED'] })
  @IsOptional()
  @IsIn(['OPEN', 'DISMISSED', 'CONFIRMED'])
  status?: 'OPEN' | 'DISMISSED' | 'CONFIRMED';
  @ApiPropertyOptional({ enum: INDICATORS })
  @IsOptional()
  @IsIn(INDICATORS as unknown as string[])
  indicator?: (typeof INDICATORS)[number];
  @ApiPropertyOptional({ description: 'Flags raised at or after this ISO 8601 timestamp.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;
  @ApiPropertyOptional({ description: 'Flags raised before this ISO 8601 timestamp.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
}

export class ReviewFlagDto {
  @ApiProperty({ enum: ['DISMISSED', 'CONFIRMED'] }) @IsIn(['DISMISSED', 'CONFIRMED']) status!:
    'DISMISSED' | 'CONFIRMED';
  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Optional note kept with the flag (not in the audit log). Do not include personal details.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

const int = (range: [number, number] | undefined) => ({
  minimum: range?.[0] ?? 0,
  maximum: range?.[1] ?? 1,
});

class StaffStampsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional(int(L.excessiveStampsPerStaff.windowMinutes))
  @IsOptional()
  @IsInt()
  @Min(L.excessiveStampsPerStaff.windowMinutes![0])
  @Max(L.excessiveStampsPerStaff.windowMinutes![1])
  windowMinutes?: number;
  @ApiPropertyOptional(int(L.excessiveStampsPerStaff.maxStamps))
  @IsOptional()
  @IsInt()
  @Min(L.excessiveStampsPerStaff.maxStamps![0])
  @Max(L.excessiveStampsPerStaff.maxStamps![1])
  maxStamps?: number;
}
class RepeatedScansDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.repeatedScansPerMembership.windowMinutes![0])
  @Max(L.repeatedScansPerMembership.windowMinutes![1])
  windowMinutes?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.repeatedScansPerMembership.maxAttempts![0])
  @Max(L.repeatedScansPerMembership.maxAttempts![1])
  maxAttempts?: number;
}
class BranchActivityDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.unusualBranchActivity.windowMinutes![0])
  @Max(L.unusualBranchActivity.windowMinutes![1])
  windowMinutes?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.unusualBranchActivity.baselineDays![0])
  @Max(L.unusualBranchActivity.baselineDays![1])
  baselineDays?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(L.unusualBranchActivity.multiplier![0])
  @Max(L.unusualBranchActivity.multiplier![1])
  multiplier?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.unusualBranchActivity.minStamps![0])
  @Max(L.unusualBranchActivity.minStamps![1])
  minStamps?: number;
}
class ReversalRateDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.highReversalRate.windowDays![0])
  @Max(L.highReversalRate.windowDays![1])
  windowDays?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.highReversalRate.minStamps![0])
  @Max(L.highReversalRate.minStamps![1])
  minStamps?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(L.highReversalRate.maxRatio![0])
  @Max(L.highReversalRate.maxRatio![1])
  maxRatio?: number;
}
class CooldownRejectionsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.repeatedCooldownRejections.windowMinutes![0])
  @Max(L.repeatedCooldownRejections.windowMinutes![1])
  windowMinutes?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.repeatedCooldownRejections.maxRejections![0])
  @Max(L.repeatedCooldownRejections.maxRejections![1])
  maxRejections?: number;
}
class RedemptionsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.excessiveRedemptions.windowMinutes![0])
  @Max(L.excessiveRedemptions.windowMinutes![1])
  windowMinutes?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(L.excessiveRedemptions.maxRedemptions![0])
  @Max(L.excessiveRedemptions.maxRedemptions![1])
  maxRedemptions?: number;
}

export class UpdateThresholdsDto {
  @ApiPropertyOptional({ type: StaffStampsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StaffStampsDto)
  excessiveStampsPerStaff?: StaffStampsDto;
  @ApiPropertyOptional({ type: RepeatedScansDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatedScansDto)
  repeatedScansPerMembership?: RepeatedScansDto;
  @ApiPropertyOptional({ type: BranchActivityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BranchActivityDto)
  unusualBranchActivity?: BranchActivityDto;
  @ApiPropertyOptional({ type: ReversalRateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReversalRateDto)
  highReversalRate?: ReversalRateDto;
  @ApiPropertyOptional({ type: CooldownRejectionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CooldownRejectionsDto)
  repeatedCooldownRejections?: CooldownRejectionsDto;
  @ApiPropertyOptional({ type: RedemptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RedemptionsDto)
  excessiveRedemptions?: RedemptionsDto;
}

class FlagDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: INDICATORS }) indicator!: string;
  @ApiProperty({ enum: ['STAFF', 'MEMBERSHIP', 'BRANCH'] }) subjectType!: string;
  @ApiProperty({ format: 'uuid' }) subjectId!: string;
  @ApiProperty({ nullable: true, description: 'Staff name, branch name or customer first name.' })
  subjectLabel!: string | null;
  @ApiProperty({ format: 'date-time' }) windowStart!: Date;
  @ApiProperty({ format: 'date-time' }) windowEnd!: Date;
  @ApiProperty({
    description: 'What was measured (a count, or a 0-1 ratio for HIGH_REVERSAL_RATE).',
  })
  observed!: number;
  @ApiProperty({ description: 'The limit it exceeded.' }) threshold!: number;
  @ApiProperty({ description: 'Counts behind the flag. Contains no personal data.' })
  details!: Record<string, unknown>;
  @ApiProperty({ enum: ['OPEN', 'DISMISSED', 'CONFIRMED'] }) status!: string;
  @ApiProperty({ nullable: true }) reviewedAt!: Date | null;
  @ApiProperty({ nullable: true }) reviewNote!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

class FlagPageDto {
  @ApiProperty({ type: [FlagDto] }) items!: FlagDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}

const INDICATOR_CATALOG = [
  {
    indicator: 'EXCESSIVE_STAMPS_BY_STAFF',
    subject: 'STAFF',
    meaning: 'One staff member issued more stamps than the limit within the window.',
  },
  {
    indicator: 'REPEATED_SCANS_FOR_MEMBERSHIP',
    subject: 'MEMBERSHIP',
    meaning:
      'One card was scanned (accepted or refused) more often than the limit within the window.',
  },
  {
    indicator: 'UNUSUAL_BRANCH_ACTIVITY',
    subject: 'BRANCH',
    meaning:
      'A branch issued several times more stamps than its own recent average for that window.',
  },
  {
    indicator: 'HIGH_REVERSAL_RATE',
    subject: 'STAFF',
    meaning: 'A large share of one staff member’s stamps were later reversed.',
  },
  {
    indicator: 'REPEATED_COOLDOWN_REJECTIONS',
    subject: 'MEMBERSHIP',
    meaning: 'One card was refused for the cooldown more often than the limit within the window.',
  },
  {
    indicator: 'EXCESSIVE_REDEMPTIONS',
    subject: 'STAFF',
    meaning: 'One staff member handed over more rewards than the limit within the window.',
  },
];

@ApiTags('Fraud monitoring')
@ApiBearerAuth()
@Controller('merchant/fraud')
export class FraudController {
  constructor(
    private readonly flags: FraudFlagsService,
    private readonly evaluation: FraudEvaluationService,
  ) {}

  @Permissions('fraud:read')
  @Get('indicators')
  @ApiOperation({
    summary: 'What each fraud indicator means',
    description:
      'Indicators only raise flags for people to review. Nothing is blocked or penalised automatically.',
  })
  indicators() {
    return INDICATOR_CATALOG;
  }

  @Permissions('fraud:read')
  @Get('flags')
  @ApiOperation({
    summary: 'Fraud flags raised for the merchant',
    description: 'Newest first, cursor-paginated. Scoped to the caller’s merchant.',
  })
  @ApiOkResponse({ type: FlagPageDto })
  list(@CurrentMerchantActor() actor: MerchantActor, @Query() query: FlagQueryDto) {
    return this.flags.list(actor, query);
  }

  @Permissions('fraud:read')
  @Get('flags/:flagId')
  @ApiOperation({ summary: 'One flag' })
  @ApiNotFoundResponse()
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('flagId', ParseUUIDPipe) flagId: string,
  ) {
    return this.flags.get(actor, flagId);
  }

  @Permissions('fraud:manage')
  @Post('flags/:flagId/review')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record a verdict on a flag (owners only)',
    description:
      'DISMISSED (false alarm) or CONFIRMED (looks genuine). This only records the decision: no customer or staff member is penalised, suspended or notified. A flag can be reviewed once.',
  })
  @ApiConflictResponse({ description: 'ALREADY_REVIEWED' })
  @ApiForbiddenResponse({ description: 'Requires fraud:manage' })
  review(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Body() dto: ReviewFlagDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.flags.review(actor, flagId, dto, meta);
  }

  @Permissions('fraud:read')
  @Get('settings')
  @ApiOperation({
    summary: 'Current fraud thresholds (defaults merged with the merchant’s overrides)',
  })
  settings(@CurrentMerchantActor() actor: MerchantActor) {
    return this.flags.getThresholds(actor);
  }

  @Permissions('fraud:manage')
  @Put('settings')
  @ApiOperation({
    summary: 'Change fraud thresholds (owners only)',
    description:
      'Partial update merged over the current settings. Out-of-range values are rejected. Only the changed field names are audited.',
  })
  updateSettings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: UpdateThresholdsDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.flags.updateThresholds(actor, dto as Record<string, Record<string, unknown>>, meta);
  }

  @Permissions('fraud:manage')
  @Post('evaluate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the fraud checks now (owners only)',
    description:
      'They also run automatically every few minutes. Re-running is safe: the same observation updates its flag instead of duplicating it.',
  })
  evaluate(@CurrentMerchantActor() actor: MerchantActor) {
    return this.evaluation.evaluate(actor.merchantId);
  }
}
