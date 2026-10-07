import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedOnly, Public } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { CurrentActor, type Actor } from '../../tenancy';
import { AuthService } from '../application/auth.service';
import { LoginDto, MeDto, RefreshTokenDto, SessionDto } from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Returns a short-lived access token and a single-use refresh token. Merchant users receive ' +
      'a token bound to their merchant; platform administrators receive a platform token. ' +
      'Failures are deliberately indistinguishable (wrong password, unknown account, deactivated ' +
      'account, temporary lockout). Rate limited per IP + email.',
  })
  @ApiOkResponse({ type: SessionDto })
  @ApiUnauthorizedResponse({ description: 'INVALID_CREDENTIALS' })
  @ApiTooManyRequestsResponse({ description: 'RATE_LIMITED' })
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(dto, meta);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Exchanges a refresh token for a new access token AND a new refresh token; the old one is ' +
      'revoked. Presenting an already-rotated token is treated as theft and revokes the whole ' +
      'device session.',
  })
  @ApiOkResponse({ type: SessionDto })
  @ApiUnauthorizedResponse({ description: 'INVALID_REFRESH_TOKEN' })
  refresh(@Body() dto: RefreshTokenDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Log out of this device',
    description:
      'Revokes the device session that owns the refresh token. Always returns 204, so the ' +
      'endpoint cannot be used to test whether a token is valid.',
  })
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshTokenDto, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.auth.logout(dto.refreshToken, meta);
  }

  @AuthenticatedOnly()
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Log out of every device', description: 'Revokes all refresh tokens.' })
  @ApiNoContentResponse()
  async logoutAll(@CurrentActor() actor: Actor, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.auth.logoutAll(actor, meta);
  }

  @AuthenticatedOnly()
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current principal, role, permissions and branch scope' })
  @ApiOkResponse({ type: MeDto })
  me(@CurrentActor() actor: Actor): MeDto {
    return {
      userId: actor.userId,
      kind: actor.kind,
      role: actor.roleKey,
      merchantId: actor.kind === 'merchant' ? actor.merchantId : null,
      permissions: [...actor.permissions].sort(),
      branchScope:
        actor.kind === 'merchant'
          ? actor.branchScope === 'ALL'
            ? 'ALL'
            : [...actor.branchScope]
          : null,
    };
  }
}
