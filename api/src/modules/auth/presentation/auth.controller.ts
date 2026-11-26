import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseFilters,
} from '@nestjs/common';
import { toSafeError } from '../../../common/errors/safe-error';
import { Public } from '../../../common/auth/public.decorator';
import { RequestSecurity } from '../../../common/auth/request-security';
import { Roles } from '../../../common/auth/roles.decorator';
import { AuthService } from '../application/auth-service';
import { AuthErrorFilter } from './auth-error.filter';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetConfirmDto,
  ResetRequestDto,
  VerifyEmailDto,
} from './auth.dtos';

/**
 * Auth endpoints (section 9). Every route here is tenant-independent identity work, so
 * none takes a tenant code. All but password change are @Public(): the server assigns
 * GUEST and the RLS policies narrow exactly what each flow can touch.
 */
@Controller('auth')
@UseFilters(AuthErrorFilter)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<{ message: string }> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(200)
  resendVerification(@Body() dto: ResendVerificationDto): Promise<{ message: string }> {
    return this.auth.resendVerificationCode(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  /** Logout is idempotent and always succeeds, even for an unknown token (section 9). */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto);
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(200)
  resetRequest(@Body() dto: ResetRequestDto): Promise<{ message: string }> {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Post('password/reset-confirm')
  @HttpCode(204)
  async resetConfirm(@Body() dto: ResetConfirmDto): Promise<void> {
    await this.auth.confirmPasswordReset(dto);
  }

  /**
   * The one authenticated route: identity comes from the verified token attached by
   * JwtAuthGuard (6.3), never from the body.
   */
  @Roles('CUSTOMER', 'MERCHANT')
  @Post('password/change')
  @HttpCode(204)
  async changePassword(@Req() req: RequestSecurity, @Body() dto: ChangePasswordDto): Promise<void> {
    const auth = req.auth;
    if (!auth) {
      // unreachable: the global JwtAuthGuard ran first; keep the type narrow without it
      throw new UnauthorizedException(toSafeError('UNAUTHENTICATED', 'Authentication required.'));
    }
    await this.auth.changePassword({ role: auth.role, userId: auth.userId }, dto);
  }
}
