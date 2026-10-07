import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { PageQueryDto } from '../../../common/http/pagination';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { AnalyticsService, MAX_COHORTS, MAX_TREND_MONTHS } from '../application/analytics.service';

const DATE_HELP =
  'A calendar date (YYYY-MM-DD, read in the merchant’s time zone; "to" includes that whole day) or an ISO 8601 timestamp ("to" exclusive). Default: the last 30 days. Maximum span 366 days.';

export class RangeQueryDto {
  @ApiPropertyOptional({ description: DATE_HELP, example: '2026-10-01' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;
  @ApiPropertyOptional({ description: DATE_HELP, example: '2026-10-31' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this loyalty program.' })
  @IsOptional()
  @IsUUID('4')
  programId?: string;
}

export class PagedRangeQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: DATE_HELP, example: '2026-10-01' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;
  @ApiPropertyOptional({ description: DATE_HELP, example: '2026-10-31' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this loyalty program.' })
  @IsOptional()
  @IsUUID('4')
  programId?: string;
}

export class MonthlyReturningQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description:
      'Calendar month in the merchant’s time zone. Default: the current month (partial).',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_TREND_MONTHS,
    default: 6,
    description: 'How many months to return, ending at `month`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TREND_MONTHS)
  months?: number;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  programId?: string;
}

export class CohortQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_COHORTS,
    default: 6,
    description: 'Join months to show, ending with the current month.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_COHORTS)
  cohorts?: number;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  programId?: string;
}

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('merchant/analytics')
@Permissions('analytics:read')
@ApiForbiddenResponse({ description: 'Requires analytics:read (owners and managers).' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('definitions')
  @ApiOperation({
    summary: 'What every metric means',
    description:
      'The exact definitions the numbers are computed with. Loyalty activity only: there are no revenue, payment or order-value metrics.',
  })
  definitions() {
    return this.analytics.definitions();
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Headline loyalty metrics for a date range',
    description:
      'New members, active members, returning customers, stamps, rewards unlocked and redeemed, redemption rate, average visits per active member and time between visits.',
  })
  @ApiOkResponse({ description: 'See GET /merchant/analytics/definitions for each field.' })
  overview(@CurrentMerchantActor() actor: MerchantActor, @Query() q: RangeQueryDto) {
    return this.analytics.overview(actor, q);
  }

  @Get('monthly-returning-customers')
  @ApiOperation({
    summary: 'North-star: Monthly Returning Loyalty Customers',
    description:
      'Unique loyalty customers with a qualifying visit in the month who also had one before that month. Returns the requested month and the months leading up to it.',
  })
  monthlyReturning(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query() q: MonthlyReturningQueryDto,
  ) {
    return this.analytics.monthlyReturning(actor, q);
  }

  @Get('returning-customers')
  @ApiOperation({
    summary: 'The returning customers behind the number (paginated)',
    description:
      'First name, visits in the range, last visit and the visit before the range. No phone numbers. Most recent first.',
  })
  returningCustomers(@CurrentMerchantActor() actor: MerchantActor, @Query() q: PagedRangeQueryDto) {
    return this.analytics.returningCustomerList(actor, q);
  }

  @Get('branches')
  @ApiOperation({ summary: 'Branch activity (paginated)', description: 'Busiest branch first.' })
  branches(@CurrentMerchantActor() actor: MerchantActor, @Query() q: PagedRangeQueryDto) {
    return this.analytics.branches(actor, q);
  }

  @Get('staff')
  @ApiOperation({
    summary: 'Staff stamping activity (paginated)',
    description: 'Most stamps first.',
  })
  staff(@CurrentMerchantActor() actor: MerchantActor, @Query() q: PagedRangeQueryDto) {
    return this.analytics.staff(actor, q);
  }

  @Get('cohorts')
  @ApiOperation({
    summary: 'Program retention cohorts',
    description:
      'Memberships grouped by join month, with the share that visited again in each following month (up to 12 months).',
  })
  cohorts(@CurrentMerchantActor() actor: MerchantActor, @Query() q: CohortQueryDto) {
    return this.analytics.cohorts(actor, q);
  }

  @Get('wallet')
  @ApiOperation({
    summary: 'Wallet provider adoption and update success',
    description:
      'Adoption is a snapshot of active cards; the update success rate covers pass-update jobs created in the range.',
  })
  wallet(@CurrentMerchantActor() actor: MerchantActor, @Query() q: RangeQueryDto) {
    return this.analytics.wallet(actor, q);
  }
}
