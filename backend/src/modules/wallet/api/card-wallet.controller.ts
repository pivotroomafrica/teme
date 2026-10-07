import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../../common/decorators/access.decorators';
import { WalletService } from '../application/wallet.service';

export class CardCredentialDto {
  @ApiProperty({ description: 'The customer’s card token (the value in their QR code).' })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  cardToken!: string;
}

export class WalletLinkDto extends CardCredentialDto {
  @ApiProperty({ enum: ['APPLE', 'GOOGLE', 'WEB'] })
  @IsIn(['APPLE', 'GOOGLE', 'WEB'])
  provider!: 'APPLE' | 'GOOGLE' | 'WEB';
}

class WalletLinkResultDto {
  @ApiProperty({ enum: ['APPLE', 'GOOGLE', 'WEB'] }) provider!: string;
  @ApiProperty({
    enum: ['DOWNLOAD', 'REDIRECT', 'NONE'],
    description:
      'DOWNLOAD: open the URL to get the pass file. REDIRECT: open the URL to add the pass. NONE: web card, nothing to add.',
  })
  kind!: string;
  @ApiProperty({ nullable: true }) url!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) expiresAt!: string | null;
}

/** Public, authorised by possession of the card token, and covered by the enrollment rate limit. */
@ApiTags('Wallet (customer)')
@Controller('card')
export class CardWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Public()
  @Post('wallet/links')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get an Add-to-Wallet link for the customer’s card',
    description:
      'Creates the pass on first use and returns a link: a short-lived signed download for Apple, a signed ' +
      '"Save to Google Wallet" link for Google. The pass carries its own barcode that the scanner accepts like the card ' +
      'token and that staff can revoke without affecting the web card.',
  })
  @ApiOkResponse({ type: WalletLinkResultDto })
  @ApiNotFoundResponse({ description: 'Unknown or inactive card' })
  @ApiConflictResponse({ description: 'PROVIDER_NOT_AVAILABLE: that wallet is not offered' })
  @ApiBadGatewayResponse({ description: 'WALLET_PROVIDER_UNAVAILABLE: try again shortly' })
  link(@Body() dto: WalletLinkDto) {
    return this.wallet.addLinkForCard(dto.cardToken, dto.provider);
  }

  @Public()
  @Post('web')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Live web card (fallback when no wallet is used)',
    description:
      'Progress, reward status and texts in English and Amharic, plus the QR value (the card token).',
  })
  @ApiNotFoundResponse({ description: 'Unknown or inactive card' })
  web(@Body() dto: CardCredentialDto) {
    return this.wallet.webCard(dto.cardToken);
  }
}
