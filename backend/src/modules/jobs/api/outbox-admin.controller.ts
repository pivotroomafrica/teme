import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { DomainError } from '../../../common/errors/domain-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuditService } from '../../audit';
import { CurrentPlatformActor, type PlatformActor } from '../../tenancy';
import { OutboxRepository } from '../infrastructure/outbox.repository';

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform/outbox')
export class OutboxAdminController {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditService,
  ) {}

  @Permissions('platform:manage')
  @Get('stats')
  @ApiOperation({ summary: 'Outbox job counts by status (platform administrators only)' })
  @ApiOkResponse({ schema: { example: { PENDING: 0, COMPLETED: 10, FAILED: 1, DEAD: 0 } } })
  stats() {
    return this.outbox.countByStatus();
  }

  @Permissions('platform:manage')
  @Get('dead')
  @ApiOperation({
    summary: 'Dead-lettered jobs (platform administrators only)',
    description:
      'Jobs that exhausted their retries or failed permanently. Error text is scrubbed of credentials.',
  })
  dead() {
    return this.outbox.listDead(100);
  }

  @Permissions('platform:manage')
  @Post('dead/:jobId/requeue')
  @HttpCode(200)
  @ApiOperation({ summary: 'Give a dead-lettered job a fresh set of attempts' })
  @ApiNotFoundResponse({ description: 'Unknown job, or not dead' })
  async requeue(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    const job = await this.outbox.requeueDead(jobId);
    if (!job) throw new DomainError(ErrorCode.NOT_FOUND, 'Dead job not found.', 404);
    await this.audit.record({
      action: 'outbox.job_requeued',
      actorUserId: actor.userId,
      merchantId: job.merchantId,
      targetType: 'outbox_job',
      targetId: job.id,
      requestId: meta.requestId,
      metadata: { type: job.type },
    });
    return job;
  }
}
