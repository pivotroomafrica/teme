import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ClaimedJob,
  OutboxHandler,
  OutboxHandlerRegistry,
  OutboxJobType,
  PermanentJobError,
} from '../../jobs';
import { WalletService } from './wallet.service';

/**
 * Delivers `wallet.pass_update` jobs. Every job means "this membership's cards may be out of date":
 * the handler re-reads the ledger and brings each stale pass current, so duplicate or coalesced jobs
 * are harmless and a late retry never pushes outdated numbers.
 */
@Injectable()
export class WalletSyncHandler implements OutboxHandler, OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly wallet: WalletService,
  ) {}

  onModuleInit(): void {
    this.registry.register(OutboxJobType.WALLET_PASS_UPDATE, this);
  }

  async handle(job: ClaimedJob): Promise<void> {
    if (!job.merchantId) throw new PermanentJobError('Wallet job has no merchant');
    await this.wallet.syncMembership(job.merchantId, job.aggregateId);
  }
}
