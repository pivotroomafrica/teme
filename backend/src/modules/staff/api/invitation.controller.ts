import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../../../common/decorators/access.decorators';
import { ReqMeta, type RequestMeta } from '../../../common/decorators/request-context.decorator';
import { StaffInvitationService } from '../application/staff-invitation.service';

export class AcceptInvitationDto {
  @ApiProperty({ description: 'The one-time invitation token.' })
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;

  @ApiProperty({ format: 'password', description: '12-128 characters with a letter and a digit.' })
  @IsString()
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;
}

@ApiTags('Authentication')
@Controller('auth/invitations')
export class InvitationController {
  constructor(private readonly invitations: StaffInvitationService) {}

  @Public()
  @Post('accept')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Accept a staff invitation and set a password',
    description:
      'Single use. Unknown, expired, revoked and already-used tokens all return the same INVALID_INVITATION error. ' +
      'After success, log in with `POST /auth/login`.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'INVALID_INVITATION or weak password' })
  async accept(@Body() dto: AcceptInvitationDto, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.invitations.accept(dto, meta);
  }
}
