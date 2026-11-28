import { completePasswordResetSchema, changePasswordSchema } from '@/utils/validators';

describe('Password Standardization to Minimum 6 Characters', () => {
  describe('completePasswordResetSchema', () => {
    const baseValid = {
      email: 'test@example.com',
      otp: '123456',
      resetToken: 'valid-reset-token-with-sufficient-length',
    };

    it('should accept password of exactly 6 characters with uppercase, lowercase, digit, and symbol', () => {
      const result = completePasswordResetSchema.safeParse({
        ...baseValid,
        newPassword: 'Ab1!xy', // 6 characters
      });
      expect(result.success).toBe(true);
    });

    it('should reject password with 5 characters', () => {
      const result = completePasswordResetSchema.safeParse({
        ...baseValid,
        newPassword: 'Ab1!x', // 5 characters
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues?.[0]?.message || (result.error as any).errors?.[0]?.message;
        expect(msg).toContain('at least 6 characters');
      }
    });
  });

  describe('changePasswordSchema', () => {
    const baseValid = {
      currentPassword: 'OldPassword123!',
    };

    it('should accept new password of exactly 6 characters', () => {
      const result = changePasswordSchema.safeParse({
        ...baseValid,
        newPassword: 'Ab1!xy',
        confirmPassword: 'Ab1!xy',
      });
      expect(result.success).toBe(true);
    });

    it('should reject new password with fewer than 6 characters', () => {
      const result = changePasswordSchema.safeParse({
        ...baseValid,
        newPassword: 'Ab1!x',
        confirmPassword: 'Ab1!x',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues?.[0]?.message || (result.error as any).errors?.[0]?.message;
        expect(msg).toContain('at least 6 characters');
      }
    });
  });
});
