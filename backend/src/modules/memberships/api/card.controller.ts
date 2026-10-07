import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Permissions, Public } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { CardService } from '../application/card.service';
import { MembershipLifecycleService } from '../application/membership-lifecycle.service';

export class WithdrawMarketingDto {
  @ApiProperty({ description: 'The customer’s card token (the value in their QR code).' })
  @IsString()
  @MinLength(20)
  @MaxLength(128)
  cardToken!: string;
}

@ApiTags('Customer enrollment (public)')
@Controller('card')
export class CardController {
  constructor(private readonly cards: CardService) {}

  @Public()
  @Post('consent/marketing/withdraw')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Customer withdraws marketing consent',
    description:
      'Authorised by possession of the card token. Only marketing consent changes: the loyalty membership, card and history are kept. Idempotent. Rate limited per IP.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Unknown card' })
  async withdraw(@Body() dto: WithdrawMarketingDto, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.cards.withdrawMarketingByCard(dto.cardToken, meta);
  }
}

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('merchant/memberships')
export class MembershipsController {
  constructor(
    private readonly cards: CardService,
    private readonly lifecycle: MembershipLifecycleService,
  ) {}

  @Permissions('customer:manage')
  @Post(':membershipId/deactivate')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a customer’s loyalty membership',
    description:
      'The card stops working at the counter and wallet cards are suspended. History and data are kept. Idempotent. Audited.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async deactivate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.lifecycle.deactivate(actor, membershipId, meta);
  }

  @Permissions('customer:manage')
  @Post(':membershipId/reactivate')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Reactivate a deactivated membership',
    description:
      'Not possible for an anonymized customer (409 CUSTOMER_ANONYMIZED). Idempotent. Audited.',
  })
  @ApiNoContentResponse()
  async reactivate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.lifecycle.reactivate(actor, membershipId, meta);
  }

  @Permissions('customer:manage')
  @Post(':membershipId/reissue-card')
  @ApiOperation({
    summary: 'Issue a replacement card token',
    description:
      'For a lost phone or compromised card. The previous token stops working immediately; wallet passes are flagged for refresh. The new token is shown once. Audited.',
  })
  @ApiCreatedResponse({ schema: { example: { token: '…' } } })
  @ApiNotFoundResponse()
  reissue(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.cards.reissueCard(actor, membershipId, meta);
  }
}
