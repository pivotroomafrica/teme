import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentMerchantActor, type MerchantActor } from '../../tenancy';
import { WalletService } from '../application/wallet.service';

class PassStatusDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['APPLE', 'GOOGLE', 'WEB'] }) provider!: string;
  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'INVALIDATED'] }) status!: string;
  @ApiProperty({ enum: ['PENDING', 'SYNCED', 'FAILED'] }) syncStatus!: string;
  @ApiProperty() passVersion!: number;
  @ApiProperty({ description: 'The version last delivered to the provider.' })
  lastSyncedVersion!: number;
  @ApiProperty({ nullable: true, format: 'date-time' }) lastSyncedAt!: Date | null;
  @ApiProperty({ nullable: true, description: 'Last delivery error, scrubbed of credentials.' })
  lastError!: string | null;
}

@ApiTags('Wallet (staff)')
@ApiBearerAuth()
@Controller('merchant')
export class WalletAdminController {
  constructor(private readonly wallet: WalletService) {}

  @Permissions('customer:read')
  @Get('memberships/:membershipId/wallet-passes')
  @ApiOperation({ summary: 'Wallet passes of a membership and their delivery status' })
  @ApiOkResponse({ type: [PassStatusDto] })
  @ApiNotFoundResponse()
  async list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<PassStatusDto[]> {
    const rows = await this.wallet.listPasses(actor, membershipId);
    return rows.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      syncStatus: p.syncStatus,
      passVersion: p.passVersion,
      lastSyncedVersion: p.lastSyncedVersion,
      lastSyncedAt: p.lastSyncedAt,
      lastError: p.lastError,
    }));
  }

  @Permissions('customer:manage')
  @Post('memberships/:membershipId/wallet-passes/invalidate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke the Apple and Google passes of a membership (lost or stolen phone)',
    description:
      'Their barcodes stop being accepted at the counter immediately and the wallets are told to void them. The web card ' +
      'and card token keep working; the customer can add a fresh pass afterwards. Audited.',
  })
  @ApiOkResponse({ schema: { example: { invalidated: 2 } } })
  async invalidate(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return { invalidated: await this.wallet.invalidatePasses(actor, membershipId, meta) };
  }

  @Permissions('customer:manage')
  @Post('wallet-passes/:passId/resync')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a fresh delivery of one pass to its wallet' })
  @ApiNotFoundResponse()
  async resync(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('passId', ParseUUIDPipe) passId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.wallet.resync(actor, passId, meta);
  }
}
