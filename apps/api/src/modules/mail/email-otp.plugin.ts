import { emailOTP } from 'better-auth/plugins';

export interface AuthMailPort {
  sendPasswordResetEmail(input: { userId: string; email: string; url: string }): Promise<void>;
  sendEmailOtp(input: {
    email: string;
    otp: string;
    type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
  }): Promise<void>;
}

export function createEmailOtpPlugin(mail: AuthMailPort) {
  return emailOTP({
    otpLength: 6,
    expiresIn: 300,
    allowedAttempts: 5,
    disableSignUp: true,
    storeOTP: 'hashed',
    sendVerificationOTP: async ({ email, otp, type }) => {
      await mail.sendEmailOtp({ email, otp, type });
    },
  });
}
