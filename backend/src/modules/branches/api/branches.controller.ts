import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { BranchesService } from '../application/branches.service';
import type { BranchRecord } from '../infrastructure/branches.repository';

export class BranchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ nullable: true }) nameAm!: string | null;
  @ApiProperty({ nullable: true }) addressText!: string | null;
  @ApiProperty({ nullable: true }) city!: string | null;
  @ApiProperty({ nullable: true, example: '+251911000000' }) phoneE164!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
}

export class CreateBranchDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) nameEn!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(120) nameAm?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(300) addressText?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(80) city?:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: '0911 234 567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}

export class UpdateBranchDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(120) nameAm?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(300) addressText?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(80) city?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(32) phone?:
    string | null;
}

const toDto = (b: BranchRecord): BranchDto => ({ ...b });

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('merchant/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Permissions('branch:read')
  @Get()
  @ApiOperation({
    summary: 'List branches visible to the caller',
    description:
      'The merchant is taken from the access token. Owners and managers see all branches (including inactive); branch staff only their assigned active branches.',
  })
  @ApiOkResponse({ type: [BranchDto] })
  async list(@CurrentMerchantActor() actor: MerchantActor): Promise<BranchDto[]> {
    return (await this.branches.list(actor)).map(toDto);
  }

  @Permissions('branch:manage')
  @Post()
  @ApiOperation({
    summary: 'Create a branch',
    description: 'Phone numbers are normalised to E.164.',
  })
  @ApiCreatedResponse({ type: BranchDto })
  async create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: CreateBranchDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchDto> {
    return toDto(await this.branches.create(actor, dto, meta));
  }

  @Permissions('branch:read')
  @Get(':branchId')
  @ApiOperation({ summary: 'Get one branch' })
  @ApiOkResponse({ type: BranchDto })
  @ApiNotFoundResponse({ description: 'Unknown, other-tenant or unassigned branch' })
  async get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<BranchDto> {
    return toDto(await this.branches.get(actor, branchId));
  }

  @Permissions('branch:manage')
  @Patch(':branchId')
  @ApiOperation({
    summary: 'Update a branch (partial)',
    description: 'Send null to clear an optional field.',
  })
  @ApiOkResponse({ type: BranchDto })
  @ApiNotFoundResponse()
  async update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchDto> {
    return toDto(await this.branches.update(actor, branchId, dto, meta));
  }

  @Permissions('branch:manage')
  @Post(':branchId/deactivate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Deactivate a branch',
    description:
      'History is preserved. Assigned staff stop being able to operate there. The last active branch cannot be deactivated. Idempotent.',
  })
  @ApiOkResponse({ type: BranchDto })
  @ApiConflictResponse({ description: 'LAST_ACTIVE_BRANCH' })
  async deactivate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchDto> {
    return toDto(await this.branches.deactivate(actor, branchId, meta));
  }

  @Permissions('branch:manage')
  @Post(':branchId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-activate a branch', description: 'Idempotent.' })
  @ApiOkResponse({ type: BranchDto })
  async activate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<BranchDto> {
    return toDto(await this.branches.activate(actor, branchId, meta));
  }
}
