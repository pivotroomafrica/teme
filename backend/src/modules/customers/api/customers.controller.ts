import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { PageQueryDto } from '../../../common/http/pagination';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { CustomersService } from '../application/customers.service';

export class CustomerSearchQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Phone number in any common Ethiopian format (exact match), 4+ digits (partial match, managers only), or part of a first name (2+ characters, case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

class MembershipSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) programId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) joinedAt!: Date;
}

export class CustomerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) firstName!: string | null;
  @ApiProperty({ nullable: true, example: '+251911234567' }) phone!: string | null;
  @ApiProperty({ description: 'True when `phone` is masked (callers without customer:manage).' })
  phoneMasked!: boolean;
  @ApiProperty({ enum: ['EN', 'AM'] }) preferredLanguage!: string;
  @ApiProperty({ format: 'date-time' }) joinedAt!: Date;
  @ApiProperty({ description: 'Current marketing consent (latest ledger row).' })
  marketingConsent!: boolean;
  @ApiProperty({ type: [MembershipSummaryDto] }) memberships!: MembershipSummaryDto[];
}

class CustomerPageDto {
  @ApiProperty({ type: [CustomerDto] }) items!: CustomerDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('merchant/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Permissions('customer:read')
  @Get()
  @ApiOperation({
    summary: 'Search the merchant’s customers',
    description:
      'Always scoped to the caller’s merchant. Paginated (newest first, `limit` ≤ 100, opaque `cursor`). ' +
      'Branch staff see masked phone numbers and must search by a complete number; owners and managers see full numbers.',
  })
  @ApiOkResponse({ type: CustomerPageDto })
  search(@CurrentMerchantActor() actor: MerchantActor, @Query() query: CustomerSearchQueryDto) {
    return this.customers.search(actor, query);
  }

  @Permissions('customer:read')
  @Get(':customerId')
  @ApiOperation({ summary: 'Get one customer' })
  @ApiOkResponse({ type: CustomerDto })
  @ApiNotFoundResponse({ description: 'Unknown or other-tenant customer' })
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ) {
    return this.customers.get(actor, customerId);
  }

  @Permissions('customer:manage')
  @Post(':customerId/consents/marketing/withdraw')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Withdraw marketing consent on the customer’s behalf',
    description:
      'Appends a WITHDRAWN row to the consent ledger. Membership, card and history are untouched. Idempotent.',
  })
  @ApiOkResponse({ type: CustomerDto })
  withdrawMarketing(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.customers.withdrawMarketing(actor, customerId, meta);
  }
}
