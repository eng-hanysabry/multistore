import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

/**
 * Request bodies for the auth endpoints. Unknown fields are rejected by the global
 * whitelist pipe (spec 5.4); tenant values in body, query or headers are therefore
 * rejected, never read (6.3).
 */

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class VerifyEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from the email' })
  code!: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  @Length(36, 36)
  refreshToken!: string;
}

export class ResetRequestDto {
  @IsEmail()
  email!: string;
}

export class ResetConfirmDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from the email' })
  code!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
