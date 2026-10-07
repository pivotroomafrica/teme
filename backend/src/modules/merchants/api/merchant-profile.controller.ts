import { Body, Controller, Delete, Get, HttpCode, Patch, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import {
  LOGO_CONTENT_TYPES,
  MerchantProfileService,
} from '../application/merchant-profile.service';
import type { ProfileRecord } from '../infrastructure/merchant-profile.repository';

class LogoDto {
  @ApiProperty() storageKey!: string;
  @ApiProperty() contentType!: string;
}

export class ProfileDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ nullable: true, description: 'Amharic display name' }) nameAm!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] }) status!: string;
  @ApiProperty({ example: 'Africa/Addis_Ababa' }) timezone!: string;
  @ApiProperty({ enum: ['EN', 'AM'] }) defaultLanguage!: string;
  @ApiProperty({ description: 'Public reference used in customer join links.' })
  joinReference!: string;
  @ApiProperty({ nullable: true }) supportEmail!: string | null;
  @ApiProperty({ nullable: true, example: '+251911000000' }) supportPhone!: string | null;
  @ApiProperty({ type: LogoDto, nullable: true }) logo!: LogoDto | null;
  @ApiProperty({ description: 'Defaults offered when creating a loyalty program.' })
  programDefaults!: { stampsRequired: number; cooldownMinutes: number };
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Send null to clear.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameAm?: string | null;

  @ApiPropertyOptional({ example: 'Africa/Addis_Ababa' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ enum: ['EN', 'AM'] })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['EN', 'AM'])
  defaultLanguage?: 'EN' | 'AM';

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  supportEmail?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '0911 234 567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  supportPhone?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  defaultStampsRequired?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10080 })
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(10080)
  defaultCooldownMinutes?: number;
}

export class SetLogoDto {
  @ApiProperty({ enum: Object.keys(LOGO_CONTENT_TYPES) })
  @IsIn(Object.keys(LOGO_CONTENT_TYPES))
  contentType!: keyof typeof LOGO_CONTENT_TYPES;
}

const toDto = (p: ProfileRecord): ProfileDto => ({
  id: p.id,
  slug: p.slug,
  nameEn: p.nameEn,
  nameAm: p.nameAm,
  status: p.status,
  timezone: p.timezone,
  defaultLanguage: p.defaultLanguage,
  joinReference: p.joinReference,
  supportEmail: p.supportEmail,
  supportPhone: p.supportPhoneE164,
  logo:
    p.logoStorageKey && p.logoContentType
      ? { storageKey: p.logoStorageKey, contentType: p.logoContentType }
      : null,
  programDefaults: {
    stampsRequired: p.defaultStampsRequired,
    cooldownMinutes: p.defaultCooldownMinutes,
  },
});

@ApiTags('Merchant profile')
@ApiBearerAuth()
@Controller('merchant/profile')
export class MerchantProfileController {
  constructor(private readonly profile: MerchantProfileService) {}

  @Permissions('merchant:read')
  @Get()
  @ApiOperation({
    summary: "View the caller's business profile",
    description: 'The merchant comes from the access token.',
  })
  @ApiOkResponse({ type: ProfileDto })
  async get(@CurrentMerchantActor() actor: MerchantActor): Promise<ProfileDto> {
    return toDto(await this.profile.get(actor));
  }

  @Permissions('merchant:update')
  @Patch()
  @ApiOperation({
    summary: 'Update the business profile',
    description:
      'Partial update: English and Amharic display names, IANA timezone, default language, support contact ' +
      'and program defaults. Only changed field names are audited.',
  })
  @ApiOkResponse({ type: ProfileDto })
  async update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: UpdateProfileDto,
    @ReqMeta() meta: RequestMeta,
  ): Promise<ProfileDto> {
    return toDto(await this.profile.update(actor, dto, meta));
  }

  @Permissions('merchant:update')
  @Put('logo')
  @ApiOperation({
    summary: 'Record logo metadata and reserve a storage key',
    description:
      'Upload-ready only: no file storage exists yet. The key is always under `merchants/<your merchant id>/`.',
  })
  @ApiOkResponse({ type: LogoDto })
  setLogo(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body() dto: SetLogoDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.profile.setLogo(actor, dto.contentType, meta);
  }

  @Permissions('merchant:update')
  @Delete('logo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove logo metadata' })
  @ApiNoContentResponse()
  async clearLogo(
    @CurrentMerchantActor() actor: MerchantActor,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.profile.clearLogo(actor, meta);
  }
}
