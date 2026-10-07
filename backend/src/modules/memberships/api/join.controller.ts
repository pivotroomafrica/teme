import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Public } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { EnrollmentService } from '../application/enrollment.service';

// Printable names only: no control characters or markup.
const SAFE_NAME = /^[\p{L}\p{M}\p{N} .'’/-]+$/u;

export class EnrollDto {
  @ApiProperty({
    example: '0911 234 567',
    description: 'Any common Ethiopian format; stored as E.164.',
  })
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ example: 'Abebe' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(SAFE_NAME, { message: 'firstName contains invalid characters' })
  firstName!: string;

  @ApiProperty({ enum: ['EN', 'AM'] }) @IsIn(['EN', 'AM']) preferredLanguage!: 'EN' | 'AM';

  @ApiProperty({ description: 'Must be true: acceptance of the program terms and privacy notice.' })
  @IsBoolean()
  @Equals(true, { message: 'acceptTerms must be true' })
  acceptTerms!: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Explicit, optional opt-in to marketing messages.',
  })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @ApiPropertyOptional({
    description:
      'The consent version the customer saw (from the join info). A stale version is rejected with 409.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  consentVersion?: string;
}

class WalletOptionDto {
  @ApiProperty({ enum: ['WEB', 'APPLE', 'GOOGLE'] }) provider!: string;
  @ApiProperty() available!: boolean;
  @ApiProperty({ enum: ['NOT_CONFIGURED'], nullable: true }) reason!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Add-to-wallet link (filled in by the wallet integration).',
  })
  addUrl!: string | null;
}

class JoinInfoDto {
  @ApiProperty() merchant!: { nameEn: string; nameAm: string | null; defaultLanguage: string };
  @ApiProperty() program!: Record<string, unknown>;
  @ApiProperty({ example: { version: '2026-10-v1' } }) consent!: { version: string };
  @ApiProperty({ type: [WalletOptionDto] }) wallet!: WalletOptionDto[];
}

class EnrollmentResultDto extends JoinInfoDto {
  @ApiProperty({ enum: ['CREATED', 'EXISTING'] }) status!: string;
  @ApiProperty({ description: 'Echo of the submitted values.' }) customer!: {
    firstName: string;
    preferredLanguage: string;
  };
  @ApiProperty({
    nullable: true,
    description:
      'Opaque card token for the QR code / wallet barcode. Returned once, only when status is CREATED.',
  })
  card!: { token: string } | null;
}

@ApiTags('Customer enrollment (public)')
@Controller('join')
export class JoinController {
  constructor(private readonly enrollment: EnrollmentService) {}

  @Public()
  @Get(':joinReference')
  @ApiOperation({
    summary: 'Public join page data',
    description:
      'What a customer sees before joining: merchant name, the active program, reward, terms and the consent version. ' +
      'Contains no internal ids. Unknown references and merchants without an active program give the same 404.',
  })
  @ApiOkResponse({ type: JoinInfoDto })
  @ApiNotFoundResponse()
  info(@Param('joinReference') joinReference: string) {
    return this.enrollment.joinInfo(joinReference);
  }

  @Public()
  @Post(':joinReference/enroll')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Enroll a customer in the merchant’s active program',
    description:
      'Creates or reuses the customer **within this merchant only** and creates the membership. Returns wallet options ' +
      '(web card always; Apple/Google when configured). Nothing is ever revealed about other merchants. A repeat ' +
      'enrollment is safe: it returns status EXISTING, issues no new card, and cannot change the stored name or consent. ' +
      'Rate limited per IP.',
  })
  @ApiCreatedResponse({ type: EnrollmentResultDto })
  @ApiConflictResponse({ description: 'CONSENT_VERSION_STALE' })
  @ApiNotFoundResponse({ description: 'Join link not available' })
  @ApiTooManyRequestsResponse()
  enroll(
    @Param('joinReference') joinReference: string,
    @Body() dto: EnrollDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.enrollment.enroll(joinReference, dto, meta);
  }
}
