import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { ProgramsService } from '../application/programs.service';
import { STAMP_ICONS } from '../domain/program-lifecycle';
import type { ProgramRecord } from '../infrastructure/programs.repository';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export class CardDisplayDto {
  @ApiPropertyOptional({ example: 'Coffee card' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) subtitle?: string;
  @ApiPropertyOptional({ enum: STAMP_ICONS })
  @IsOptional()
  @IsIn(STAMP_ICONS as unknown as string[])
  stampIcon?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showProgressText?: boolean;
}

export class RewardInputDto {
  @ApiProperty({ example: 'Free coffee' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn!: string;
  @ApiPropertyOptional({ nullable: true, example: 'ነጻ ቡና' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAm?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  descriptionEn?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  descriptionAm?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Days an unlocked reward stays redeemable. Omit or null for no expiry.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  validForDays?: number | null;
}

export class RewardPatchDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(120) nameAm?:
    string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  descriptionEn?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  descriptionAm?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(3650) validForDays?:
    number | null;
}

export class CreateProgramDto {
  @ApiProperty({ example: 'Coffee Stamp Card' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn!: string;
  @ApiPropertyOptional({ nullable: true, example: 'የቡና ስታምፕ ካርድ' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAm?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) termsEn?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) termsAm?:
    string | null;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    description: 'Defaults to the merchant default.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  stampsRequired?: number;
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10080,
    description: 'Minutes between two stamps for one member. Defaults to the merchant default.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  cooldownMinutes?: number;
  @ApiPropertyOptional({ example: '#7A4B2A' })
  @IsOptional()
  @Matches(HEX_COLOR)
  brandColor?: string;
  @ApiPropertyOptional({ type: CardDisplayDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CardDisplayDto)
  cardDisplay?: CardDisplayDto;
  @ApiProperty({ type: RewardInputDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RewardInputDto)
  reward!: RewardInputDto;
}

export class UpdateProgramDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(120) nameAm?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) termsEn?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(2000) termsAm?:
    string | null;
  @ApiPropertyOptional({ description: 'Locked (409 PROGRAM_LOCKED) once any customer has joined.' })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  stampsRequired?: number;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(10080)
  cooldownMinutes?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Matches(HEX_COLOR) brandColor?:
    string | null;
  @ApiPropertyOptional({ type: CardDisplayDto })
  @ValidateIf((_, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => CardDisplayDto)
  cardDisplay?: CardDisplayDto;
  @ApiPropertyOptional({ type: RewardPatchDto })
  @ValidateIf((_, v) => v !== undefined)
  @ValidateNested()
  @Type(() => RewardPatchDto)
  reward?: RewardPatchDto;
}

class RewardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ nullable: true }) nameAm!: string | null;
  @ApiProperty({ nullable: true }) descriptionEn!: string | null;
  @ApiProperty({ nullable: true }) descriptionAm!: string | null;
  @ApiProperty({ nullable: true }) validForDays!: number | null;
}

export class ProgramDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] }) status!: string;
  @ApiProperty({
    description: 'The default program is the one new customers join (only while ACTIVE).',
  })
  isDefault!: boolean;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ nullable: true }) nameAm!: string | null;
  @ApiProperty({ nullable: true }) termsEn!: string | null;
  @ApiProperty({ nullable: true }) termsAm!: string | null;
  @ApiProperty() stampsRequired!: number;
  @ApiProperty() cooldownMinutes!: number;
  @ApiProperty({ nullable: true }) brandColor!: string | null;
  @ApiProperty({ type: CardDisplayDto }) cardDisplay!: Record<string, unknown>;
  @ApiProperty({ type: RewardDto, nullable: true }) reward!: RewardDto | null;
  @ApiProperty({ description: 'Customers enrolled. When above zero, stampsRequired is locked.' })
  memberCount!: number;
  @ApiProperty() stampsRequiredLocked!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
}

const toDto = (p: ProgramRecord): ProgramDto => ({
  id: p.id,
  status: p.status,
  isDefault: p.isDefault,
  nameEn: p.nameEn,
  nameAm: p.nameAm,
  termsEn: p.termsEn,
  termsAm: p.termsAm,
  stampsRequired: p.stampsRequired,
  cooldownMinutes: p.cooldownMinutes,
  brandColor: p.brandColor,
  cardDisplay: p.cardDisplay,
  reward: p.reward,
  memberCount: p.membershipCount,
  stampsRequiredLocked: p.membershipCount > 0,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

@ApiTags('Loyalty programs')
@ApiBearerAuth()
@Controller('merchant/programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Permissions('program:read')
  @Get()
  @ApiOperation({ summary: "List the merchant's loyalty programs" })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] })
  @ApiOkResponse({ type: [ProgramDto] })
  async list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query('status') status?: string,
  ): Promise<ProgramDto[]> {
    const allowed = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
    const filter = allowed.find((s) => s === status);
    return (await this.programs.list(actor, filter)).map(toDto);
  }

  @Permissions('program:manage')
  @Post()
  @ApiOperation({
    summary: 'Create a stamp-based program (as DRAFT)',
    description:
      'Includes the reward (English and Amharic text). Stamp count and cooldown default to the merchant defaults. ' +
      'Activate it with `POST /merchant/programs/:id/activate`.',
  })
  @ApiCreatedResponse({ type: ProgramDto })
  async create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: CreateProgramDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProgramDto> {
    return toDto(await this.programs.create(actor, dto, meta));
  }

  @Permissions('program:read')
  @Get(':programId')
  @ApiOperation({ summary: 'Get one program' })
  @ApiOkResponse({ type: ProgramDto })
  @ApiNotFoundResponse()
  async get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('programId', ParseUUIDPipe) programId: string,
  ): Promise<ProgramDto> {
    return toDto(await this.programs.get(actor, programId));
  }

  @Permissions('program:manage')
  @Patch(':programId')
  @ApiOperation({
    summary: 'Update a program (partial)',
    description:
      'Names, terms, colour, card display, cooldown and reward text can be edited until the program is archived. ' +
      "The stamp requirement is locked once any customer has joined (409 PROGRAM_LOCKED) because it would change members' progress.",
  })
  @ApiOkResponse({ type: ProgramDto })
  @ApiConflictResponse({ description: 'PROGRAM_LOCKED or PROGRAM_ARCHIVED' })
  async update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('programId', ParseUUIDPipe) programId: string,
    @Body() dto: UpdateProgramDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProgramDto> {
    return toDto(await this.programs.update(actor, programId, dto, meta));
  }

  @Permissions('program:manage')
  @Post(':programId/activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activate a draft or paused program',
    description:
      'It becomes the default program that new customers join. Only one default ACTIVE program per merchant (409 DEFAULT_PROGRAM_EXISTS). Idempotent.',
  })
  @ApiOkResponse({ type: ProgramDto })
  async activate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('programId', ParseUUIDPipe) programId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProgramDto> {
    return toDto(await this.programs.activate(actor, programId, meta));
  }

  @Permissions('program:manage')
  @Post(':programId/pause')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pause an active program',
    description:
      'No new customers can join. Existing memberships and history are untouched. Idempotent.',
  })
  @ApiOkResponse({ type: ProgramDto })
  async pause(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('programId', ParseUUIDPipe) programId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProgramDto> {
    return toDto(await this.programs.pause(actor, programId, meta));
  }

  @Permissions('program:manage')
  @Post(':programId/archive')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archive a program (terminal)',
    description: 'Nothing is deleted: memberships and ledger history are kept. Idempotent.',
  })
  @ApiOkResponse({ type: ProgramDto })
  async archive(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('programId', ParseUUIDPipe) programId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProgramDto> {
    return toDto(await this.programs.archive(actor, programId, meta));
  }
}
