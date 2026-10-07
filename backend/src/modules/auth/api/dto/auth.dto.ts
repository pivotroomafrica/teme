import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner@sample-cafe.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional({ description: 'Human label for this device, shown in session lists.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'The opaque refresh token returned by login or a previous refresh.' })
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  refreshToken!: string;
}

export class SessionUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['PLATFORM_ADMIN', 'MERCHANT_USER'] }) accountType!: string;
  @ApiProperty({ example: 'OWNER' }) role!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) merchantId!: string | null;
}

export class SessionDto {
  @ApiProperty({ description: 'Short-lived JWT. Send as `Authorization: Bearer <token>`.' })
  accessToken!: string;
  @ApiProperty({ description: 'Single-use opaque token. Each refresh returns a new one.' })
  refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: 'Bearer';
  @ApiProperty({ description: 'Access token lifetime in seconds.' }) expiresIn!: number;
  @ApiProperty({ type: SessionUserDto }) user!: SessionUserDto;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['platform', 'merchant'] }) kind!: string;
  @ApiProperty() role!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) merchantId!: string | null;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({
    description: '"ALL" or the list of branch ids this account may operate at.',
    oneOf: [
      { type: 'string', enum: ['ALL'] },
      { type: 'array', items: { type: 'string' } },
    ],
    nullable: true,
  })
  branchScope!: 'ALL' | string[] | null;
}
