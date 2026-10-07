import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { PageQueryDto } from '../../../common/http/pagination';
import {
  CurrentMerchantActor,
  CurrentPlatformActor,
  type MerchantActor,
  type PlatformActor,
} from '../../tenancy';
import { AuditQueryService } from '../application/audit-query.service';

const ACTION = /^[a-z0-9_.]{1,80}$/;

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Start (inclusive): a date (YYYY-MM-DD, read in the merchant’s time zone) or an ISO 8601 timestamp. Default: 30 days before `to`.',
    example: '2026-10-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @ApiPropertyOptional({
    description:
      'End: a date (that whole local day is included) or an ISO 8601 timestamp (exclusive). Default: now. Maximum span 366 days.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only actions by this user.' })
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only actions at this branch.' })
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @ApiPropertyOptional({ example: 'staff.role_changed', description: 'Exact action name.' })
  @IsOptional()
  @Matches(ACTION)
  action?: string;

  @ApiPropertyOptional({
    example: 'staff.',
    description: 'Actions starting with this text, e.g. "auth." or "stamp.".',
  })
  @IsOptional()
  @Matches(ACTION)
  actionPrefix?: string;

  @ApiPropertyOptional({ example: 'membership' })
  @IsOptional()
  @Matches(/^[a-z_]{1,40}$/)
  targetType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) targetId?: string;
}

export class PlatformAuditQueryDto extends AuditQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Merchant whose history to read. Omit to read platform-level events only. Naming a merchant is itself audited.',
  })
  @IsOptional()
  @IsUUID('4')
  merchantId?: string;
}

class AuditEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: Date;
  @ApiProperty({ example: 'staff.role_changed' }) action!: string;
  @ApiProperty() actor!: { type: string; userId: string | null; displayName: string | null };
  @ApiProperty({ nullable: true }) branchId!: string | null;
  @ApiProperty({ nullable: true }) targetType!: string | null;
  @ApiProperty({ nullable: true }) targetId!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Correlates with the X-Request-Id of the request that caused it.',
  })
  requestId!: string | null;
  @ApiProperty({
    description:
      'Safe metadata only: secrets, tokens, passwords and contact details never enter the audit log.',
  })
  metadata!: unknown;
}

class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] }) items!: AuditEntryDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}

@ApiTags('Audit')
@ApiBearerAuth()
@Controller()
export class AuditController {
  constructor(private readonly query: AuditQueryService) {}

  @Permissions('audit:read')
  @Get('merchant/audit')
  @ApiOperation({
    summary: 'The merchant’s audit history',
    description:
      'Append-only record of who did what, where and when. Always scoped to the caller’s merchant. Filter by date, ' +
      'actor, branch and action. Newest first, cursor-paginated. Owners also see IP and device details; managers do not.',
  })
  @ApiOkResponse({ type: AuditPageDto })
  @ApiForbiddenResponse({ description: 'Requires audit:read (owners and managers)' })
  forMerchant(@CurrentMerchantActor() actor: MerchantActor, @Query() dto: AuditQueryDto) {
    return this.query.forMerchant(actor, dto);
  }

  @Permissions('platform:audit:read')
  @Get('platform/audit')
  @ApiOperation({
    summary: 'Audit history for platform administrators',
    description:
      'Requires the explicit `platform:audit:read` permission (`platform:manage` alone is not enough). Without `merchantId` only ' +
      'platform-level events are returned. Reading a merchant’s history is recorded in that merchant’s own audit log.',
  })
  @ApiOkResponse({ type: AuditPageDto })
  @ApiForbiddenResponse({ description: 'Requires platform:audit:read' })
  forPlatform(
    @CurrentPlatformActor() actor: PlatformActor,
    @Query() dto: PlatformAuditQueryDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    const { merchantId, ...query } = dto;
    return this.query.forPlatform(actor, merchantId, query, meta.requestId);
  }
}
