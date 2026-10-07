import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentPlatformActor, type PlatformActor } from '../../tenancy';
import { AccountsService } from '../application/accounts.service';

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform/users')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Permissions('platform:manage')
  @Post(':userId/deactivate')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a login account (platform administrators only)',
    description:
      'Blocks future logins, rejects existing access tokens on their next use, and revokes all refresh tokens. Audited.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'Caller is not a platform administrator' })
  async deactivate(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.accounts.deactivateUser(actor, userId, meta);
  }
}
