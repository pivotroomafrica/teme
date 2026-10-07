import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { PageQueryDto } from '../../../common/http/pagination';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { StaffActivityService } from '../application/staff-activity.service';
import { StaffInvitationService } from '../application/staff-invitation.service';
import { StaffService } from '../application/staff.service';
import { MERCHANT_ROLES } from '../domain/staff-policy';

export class StaffDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: MERCHANT_ROLES }) roleKey!: string;
  @ApiProperty({ enum: ['INVITED', 'ACTIVE', 'DEACTIVATED'] }) status!: string;
  @ApiProperty({ type: [String], description: 'Branches this member is assigned to.' })
  branchIds!: string[];
}

export class ChangeRoleDto {
  @ApiProperty({ enum: MERCHANT_ROLES })
  @IsIn(MERCHANT_ROLES as unknown as string[])
  role!: string;
}

export class SetBranchesDto {
  @ApiProperty({
    type: [String],
    description: 'The complete set of branches (replaces the current assignments).',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  branchIds!: string[];
}

export class InviteStaffDto {
  @ApiProperty({ example: 'new.cashier@example.com' }) @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) displayName!: string;
  @ApiProperty({ enum: MERCHANT_ROLES }) @IsIn(MERCHANT_ROLES as unknown as string[]) role!: string;
  @ApiProperty({ type: [String], description: 'Required (at least one) for the STAFF role.' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  branchIds!: string[];
  @ApiPropertyOptional({ enum: ['EN', 'AM'] })
  @IsOptional()
  @IsIn(['EN', 'AM'])
  preferredLanguage?: 'EN' | 'AM';
}

class InvitationDto {
  @ApiProperty({
    description:
      'One-time secret. Deliver it to the invitee (e.g. in a link). It is shown only in this response and cannot be retrieved later; reissue to get a new one.',
  })
  token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}

export class InvitedStaffDto {
  @ApiProperty({ type: StaffDto }) staff!: StaffDto;
  @ApiProperty({ type: InvitationDto }) invitation!: InvitationDto;
}

class ActivityEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'auth.login' }) action!: string;
  @ApiProperty({ nullable: true }) targetType!: string | null;
  @ApiProperty({ nullable: true }) targetId!: string | null;
  @ApiProperty({ nullable: true }) branchId!: string | null;
  @ApiProperty({ format: 'date-time' }) occurredAt!: Date;
}

class ActivityPageDto {
  @ApiProperty({ type: [ActivityEventDto] }) items!: ActivityEventDto[];
  @ApiProperty({ nullable: true, description: 'Pass as `cursor` to fetch the next page.' })
  nextCursor!: string | null;
}

export class StaffActivityDto {
  @ApiProperty() staff!: { id: string; displayName: string; roleKey: string; status: string };
  @ApiProperty({ description: 'Counts from the append-only ledgers.' }) summary!: {
    stampsIssued: number;
    redemptionsProcessed: number;
    reversalsPerformed: number;
    lastActiveAt: Date | null;
  };
  @ApiProperty({ type: ActivityPageDto }) events!: ActivityPageDto;
}

const toDto = (s: StaffDto): StaffDto => ({
  id: s.id,
  displayName: s.displayName,
  email: s.email,
  roleKey: s.roleKey,
  status: s.status,
  branchIds: s.branchIds,
});

@ApiTags('Staff')
@ApiBearerAuth()
@Controller('merchant/staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly invitations: StaffInvitationService,
    private readonly activity: StaffActivityService,
  ) {}

  @Permissions('staff:read')
  @Get()
  @ApiOperation({
    summary: "List the merchant's staff",
    description: "Scoped to the caller's merchant.",
  })
  @ApiOkResponse({ type: [StaffDto] })
  async list(@CurrentMerchantActor() actor: MerchantActor): Promise<StaffDto[]> {
    return (await this.staff.list(actor)).map(toDto);
  }

  @Permissions('staff:manage')
  @Post()
  @ApiOperation({
    summary: 'Invite a staff member',
    description:
      'Creates the account in INVITED status and returns a one-time invitation token. Owners can invite any role; ' +
      'managers can invite branch staff only. The invitee completes onboarding at `POST /auth/invitations/accept`. ' +
      'Email delivery is not implemented: hand the token to the invitee yourself.',
  })
  @ApiCreatedResponse({ type: InvitedStaffDto })
  @ApiForbiddenResponse({ description: 'Not allowed to invite this role' })
  @ApiConflictResponse({ description: 'INVITE_NOT_POSSIBLE (address already in use)' })
  async invite(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: InviteStaffDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<InvitedStaffDto> {
    const result = await this.invitations.invite(actor, dto, meta);
    return { staff: toDto(result.staff), invitation: result.invitation };
  }

  @Permissions('staff:read')
  @Get(':staffId')
  @ApiOperation({ summary: 'Get one staff member' })
  @ApiOkResponse({ type: StaffDto })
  @ApiNotFoundResponse({ description: 'Unknown or other-tenant staff member' })
  async get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ): Promise<StaffDto> {
    return toDto(await this.staff.get(actor, staffId));
  }

  @Permissions('staff:read')
  @Get(':staffId/activity')
  @ApiOperation({
    summary: "View a staff member's activity",
    description:
      'Ledger counts plus a newest-first, cursor-paginated feed of audited actions. Event metadata (IP addresses, etc.) is not exposed here.',
  })
  @ApiOkResponse({ type: StaffActivityDto })
  @ApiNotFoundResponse()
  activityFeed(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.activity.get(actor, staffId, query);
  }

  @Permissions('staff:manage')
  @Post(':staffId/invitation')
  @ApiOperation({
    summary: 'Reissue an invitation',
    description:
      'Invalidates the previous link and returns a new one-time token. Only for members who have not accepted yet.',
  })
  @ApiCreatedResponse({ type: InvitationDto })
  @ApiConflictResponse({ description: 'Member is not in INVITED status' })
  reissue(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.invitations.reissue(actor, staffId, meta);
  }

  @Permissions('staff:manage')
  @Patch(':staffId/role')
  @ApiOperation({
    summary: "Change a staff member's role",
    description:
      'Owners can change anyone else; managers can only manage branch staff. Nobody can change ' +
      'their own role, and the last active owner cannot be demoted. Audited.',
  })
  @ApiOkResponse({ type: StaffDto })
  @ApiForbiddenResponse({ description: 'Not allowed to manage this member or grant this role' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'LAST_OWNER' })
  async changeRole(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: ChangeRoleDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<StaffDto> {
    return toDto(await this.staff.changeRole(actor, staffId, dto.role, meta));
  }

  @Permissions('staff:manage')
  @Put(':staffId/branches')
  @ApiOperation({
    summary: 'Assign a staff member to branches',
    description:
      'Replaces the assignment set. Added branches must be active branches of your merchant. Branch staff need at least one. Audited.',
  })
  @ApiOkResponse({ type: StaffDto })
  async setBranches(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: SetBranchesDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<StaffDto> {
    return toDto(await this.staff.setBranches(actor, staffId, dto.branchIds, meta));
  }

  @Permissions('staff:manage')
  @Post(':staffId/activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-activate a deactivated staff member',
    description: 'Idempotent. Pending invitations must be accepted instead.',
  })
  @ApiOkResponse({ type: StaffDto })
  async activate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<StaffDto> {
    return toDto(await this.staff.activate(actor, staffId, meta));
  }

  @Permissions('staff:manage')
  @Post(':staffId/deactivate')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a staff member',
    description:
      'History is preserved. Revokes their sessions and any pending invitation. The last active owner cannot be deactivated. Audited.',
  })
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: 'LAST_OWNER' })
  async deactivate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.staff.deactivate(actor, staffId, meta);
  }
}
