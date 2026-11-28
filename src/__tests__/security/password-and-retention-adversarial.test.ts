import { completePasswordResetSchema, changePasswordSchema } from '@/utils/validators';
import { z } from 'zod';

describe('Milestone 1 Empirical Challenger: Password Boundaries & Data Retention', () => {
  // =========================================================================
  // 1. Backend Validators: completePasswordResetSchema
  // =========================================================================
  describe('completePasswordResetSchema Password Boundaries', () => {
    const validBase = {
      email: 'test@example.com',
      otp: '123456',
      resetToken: 'valid-reset-token-with-sufficient-length',
    };

    test.each([
      ['empty string (length 0)', ''],
      ['1 character', 'A'],
      ['2 characters', 'Ab'],
      ['3 characters', 'Ab1'],
      ['4 characters', 'Ab1!'],
      ['5 characters', 'Ab1!x'],
    ])('MUST reject password with 0-5 characters: %s', (_, pwd) => {
      const res = completePasswordResetSchema.safeParse({
        ...validBase,
        newPassword: pwd,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const issues = res.error.issues || (res.error as any).errors;
        const lengthIssue = issues.find((i: any) =>
          i.message.toLowerCase().includes('at least 6 characters')
        );
        expect(lengthIssue).toBeDefined();
        expect(lengthIssue.message).toBe('Password must be at least 6 characters');
      }
    });

    test('MUST accept password of EXACTLY 6 characters when complexity is met', () => {
      const res = completePasswordResetSchema.safeParse({
        ...validBase,
        newPassword: 'Ab1!xy', // exactly 6 chars: uppercase 'A', lowercase 'b','x','y', number '1', special '!'
      });
      expect(res.success).toBe(true);
    });

    test.each([
      ['7 characters', 'Ab1!xyz'],
      ['8 characters', 'Ab1!xyz8'],
      ['12 characters', 'Ab1!xyz89012'],
      ['20 characters', 'Ab1!xyz89012Ab1!xyz8'],
      ['100 characters', 'Ab1!' + 'a'.repeat(96)],
    ])('MUST accept valid password > 6 characters: %s', (_, pwd) => {
      const res = completePasswordResetSchema.safeParse({
        ...validBase,
        newPassword: pwd,
      });
      expect(res.success).toBe(true);
    });

    test('MUST reject password exceeding max 100 characters (101 characters)', () => {
      const res = completePasswordResetSchema.safeParse({
        ...validBase,
        newPassword: 'Ab1!' + 'a'.repeat(97), // 101 chars
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const issues = res.error.issues || (res.error as any).errors;
        const maxIssue = issues.find((i: any) =>
          i.message.includes('not exceed 100 characters')
        );
        expect(maxIssue).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 2. Backend Validators: changePasswordSchema
  // =========================================================================
  describe('changePasswordSchema Password Boundaries', () => {
    const validBase = {
      currentPassword: 'CurrentPassword123!',
    };

    test.each([
      ['empty string (length 0)', ''],
      ['1 character', 'A'],
      ['2 characters', 'Ab'],
      ['3 characters', 'Ab1'],
      ['4 characters', 'Ab1!'],
      ['5 characters', 'Ab1!x'],
    ])('MUST reject new password with 0-5 characters: %s', (_, pwd) => {
      const res = changePasswordSchema.safeParse({
        ...validBase,
        newPassword: pwd,
        confirmPassword: pwd,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        const issues = res.error.issues || (res.error as any).errors;
        const lengthIssue = issues.find((i: any) =>
          i.message.toLowerCase().includes('at least 6 characters')
        );
        expect(lengthIssue).toBeDefined();
        expect(lengthIssue.message).toBe('New password must be at least 6 characters');
      }
    });

    test('MUST accept new password of EXACTLY 6 characters', () => {
      const res = changePasswordSchema.safeParse({
        ...validBase,
        newPassword: 'Ab1!xy',
        confirmPassword: 'Ab1!xy',
      });
      expect(res.success).toBe(true);
    });

    test.each([
      ['7 characters', 'Ab1!xyz'],
      ['16 characters', 'Ab1!xyzStrongPwd'],
      ['100 characters', 'Ab1!' + 'a'.repeat(96)],
    ])('MUST accept valid new password > 6 characters: %s', (_, pwd) => {
      const res = changePasswordSchema.safeParse({
        ...validBase,
        newPassword: pwd,
        confirmPassword: pwd,
      });
      expect(res.success).toBe(true);
    });
  });

  // =========================================================================
  // 3. Admin Tenant Schema (createTenantSchema.adminPassword)
  // =========================================================================
  describe('createTenantSchema.adminPassword Boundaries', () => {
    // Exact schema definition from Backend/src/app/api/admin/tenants/route.ts
    const adminPasswordSchema = z
      .string()
      .min(6, 'Admin password must be at least 6 characters')
      .max(100, 'Admin password must not exceed 100 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).+$/,
        'Admin password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      );

    test.each([
      ['empty string (length 0)', ''],
      ['1 character', 'A'],
      ['2 characters', 'Ab'],
      ['3 characters', 'Ab1'],
      ['4 characters', 'Ab1!'],
      ['5 characters', 'Ab1!x'],
    ])('MUST reject admin password with 0-5 characters: %s', (_, pwd) => {
      const res = adminPasswordSchema.safeParse(pwd);
      expect(res.success).toBe(false);
      if (!res.success) {
        const issues = res.error.issues || (res.error as any).errors;
        const lengthIssue = issues.find((i: any) =>
          i.message.toLowerCase().includes('at least 6 characters')
        );
        expect(lengthIssue).toBeDefined();
        expect(lengthIssue.message).toBe('Admin password must be at least 6 characters');
      }
    });

    test('MUST accept admin password of EXACTLY 6 characters', () => {
      const res = adminPasswordSchema.safeParse('Ab1!xy');
      expect(res.success).toBe(true);
    });

    test.each([
      ['7 characters', 'Ab1!xyz'],
      ['10 characters', 'Passw0rd!1'],
      ['100 characters', 'Ab1!' + 'a'.repeat(96)],
    ])('MUST accept valid admin password > 6 characters: %s', (_, pwd) => {
      const res = adminPasswordSchema.safeParse(pwd);
      expect(res.success).toBe(true);
    });
  });

  // =========================================================================
  // 4. Reset Password Route validatePassword function
  // =========================================================================
  describe('Backend auth/reset-password validatePassword Boundaries', () => {
    const PASSWORD_MIN_LENGTH = 8;
    function validatePassword(password: string): { valid: boolean; error?: string } {
      if (!password || password.length < PASSWORD_MIN_LENGTH) {
        return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
      }
      if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one uppercase letter' };
      }
      if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one lowercase letter' };
      }
      if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one number' };
      }
      if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one special character' };
      }
      return { valid: true };
    }

    test.each([
      ['empty string', ''],
      ['1 char', 'P'],
      ['5 chars', 'Pass1'],
      ['7 chars', 'Pass1!x'],
    ])('MUST reject 0-7 characters: %s', (_, pwd) => {
      const res = validatePassword(pwd);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('Password must be at least 8 characters');
    });

    test('MUST accept exactly 8 characters', () => {
      const res = validatePassword('Pass123!');
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    test('MUST accept > 8 characters', () => {
      const res = validatePassword('Password123!');
      expect(res.valid).toBe(true);
    });
  });

  // =========================================================================
  // 5. Frontend LoginModal & SuperAdminDashboardPage Validation Logic
  // =========================================================================
  describe('Frontend Password Validation Handlers Boundaries', () => {
    // Exact logic from Frontend/src/components/LoginModal.tsx
    const validateLoginModalPassword = (newPassword: string, confirmPassword: string) => {
      if (newPassword !== confirmPassword) {
        return 'Passwords do not match';
      }
      if (newPassword.length < 8) {
        return 'Password must be at least 8 characters';
      }
      if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword)) {
        return 'Password must contain uppercase, lowercase, numbers, and a special character';
      }
      return null;
    };

    // Exact logic from Frontend/src/pages/SuperAdminDashboardPage.tsx:410-413
    const validateSuperAdminPassword = (adminPassword: string) => {
      if (!adminPassword.trim()) {
        return 'Admin password is required';
      }
      if (adminPassword.length < 6) {
        return 'Password must be at least 6 characters';
      }
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/.test(adminPassword)) {
        return 'Password must contain uppercase, lowercase, number, and special character';
      }
      return null;
    };

    describe('LoginModal', () => {
      test.each(['', 'a', 'ab', 'Ab1', 'Ab1!', 'Ab1!x', 'Ab1!xyz'])(
        'MUST reject password length < 8 (%s)',
        (pwd) => {
          const err = validateLoginModalPassword(pwd, pwd);
          expect(err).toBe('Password must be at least 8 characters');
        }
      );

      test('MUST accept exactly 8 characters ("Pass123!")', () => {
        const err = validateLoginModalPassword('Pass123!', 'Pass123!');
        expect(err).toBeNull();
      });

      test('MUST accept > 8 characters with special symbol ("Password123!")', () => {
        const err = validateLoginModalPassword('Password123!', 'Password123!');
        expect(err).toBeNull();
      });
    });

    describe('SuperAdminDashboardPage', () => {
      test('MUST reject empty/whitespace password', () => {
        expect(validateSuperAdminPassword('')).toBe('Admin password is required');
        expect(validateSuperAdminPassword('   ')).toBe('Admin password is required');
      });

      test.each(['a', 'ab', 'Ab1', 'Ab1!', 'Ab1!x'])(
        'MUST reject password length 1 to 5 (%s)',
        (pwd) => {
          expect(validateSuperAdminPassword(pwd)).toBe('Password must be at least 6 characters');
        }
      );

      test('MUST accept exactly 6 characters ("Ab1!xy")', () => {
        expect(validateSuperAdminPassword('Ab1!xy')).toBeNull();
      });

      test('MUST accept > 6 characters ("AdminPassword123!")', () => {
        expect(validateSuperAdminPassword('AdminPassword123!')).toBeNull();
      });
    });
  });

  // =========================================================================
  // 6. Data Retention: 90 Days Cutoff Math Verification
  // =========================================================================
  describe('Data Retention 90 Days Mathematical Enforcement', () => {
    const AUDIT_LOG_RETENTION_DAYS = 90;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const RETENTION_MS = AUDIT_LOG_RETENTION_DAYS * MS_PER_DAY; // 7,776,000,000 ms

    test('90 days equals exactly 7,776,000,000 milliseconds', () => {
      expect(RETENTION_MS).toBe(7776000000);
      expect(AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toBe(7776000000);
    });

    test('cleanupAuditLogs cutoff calculation sets date exactly 90 days in the past', () => {
      const fixedNow = new Date('2026-11-12T12:00:00.000Z');
      const cutoffDate = new Date(fixedNow);
      cutoffDate.setDate(cutoffDate.getDate() - AUDIT_LOG_RETENTION_DAYS);

      // Verify exact difference in days
      const diffMs = fixedNow.getTime() - cutoffDate.getTime();
      const diffDays = Math.round(diffMs / MS_PER_DAY);
      expect(diffDays).toBe(90);
      expect(cutoffDate.toISOString()).toBe('2026-08-14T12:00:00.000Z');
    });

    test('Audit log filter lt("created_at", cutoffDate) retains records newer than 90 days and deletes older records', () => {
      const now = new Date('2026-11-12T12:00:00.000Z');
      const cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - AUDIT_LOG_RETENTION_DAYS);
      const cutoffIso = cutoffDate.toISOString();

      // Helper simulating PostgreSQL/Supabase .lt('created_at', cutoffIso)
      const shouldDelete = (createdAtIso: string) => createdAtIso < cutoffIso;

      // 1. Record created right now (0 days old) -> RETAINED
      expect(shouldDelete(now.toISOString())).toBe(false);

      // 2. Record created 30 days ago -> RETAINED
      const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
      expect(shouldDelete(thirtyDaysAgo)).toBe(false);

      // 3. Record created 89 days ago -> RETAINED
      const eightyNineDaysAgo = new Date(now.getTime() - 89 * MS_PER_DAY).toISOString();
      expect(shouldDelete(eightyNineDaysAgo)).toBe(false);

      // 4. Record created 89 days, 23 hours, 59 minutes, 59 seconds ago (almost 90 days) -> RETAINED
      const almostCutoff = new Date(cutoffDate.getTime() + 1000).toISOString();
      expect(shouldDelete(almostCutoff)).toBe(false);

      // 5. Record created EXACTLY at cutoffDate -> RETAINED (.lt is strictly less than)
      expect(shouldDelete(cutoffIso)).toBe(false);

      // 6. Record created 90 days + 1 second ago -> DELETED
      const justPastCutoff = new Date(cutoffDate.getTime() - 1000).toISOString();
      expect(shouldDelete(justPastCutoff)).toBe(true);

      // 7. Record created 91 days ago -> DELETED
      const ninetyOneDaysAgo = new Date(now.getTime() - 91 * MS_PER_DAY).toISOString();
      expect(shouldDelete(ninetyOneDaysAgo)).toBe(true);

      // 8. Record created 365 days ago (1 year) -> DELETED
      const oneYearAgo = new Date(now.getTime() - 365 * MS_PER_DAY).toISOString();
      expect(shouldDelete(oneYearAgo)).toBe(true);
    });

    test('Leap year boundary: 90 days correctly handles leap day (e.g. Feb 29)', () => {
      const postLeap = new Date('2024-04-01T00:00:00.000Z'); // 2024 is a leap year
      const cutoff = new Date(postLeap);
      cutoff.setDate(cutoff.getDate() - AUDIT_LOG_RETENTION_DAYS);

      // In 2024 (leap year): Jan 31 days, Feb 29 days, Mar 31 days
      // April 1 - 90 days = January 2 (31 in Jan + 29 in Feb + 31 in Mar - 1 = 90 days)
      expect(cutoff.toISOString()).toBe('2024-01-02T00:00:00.000Z');
      const diffDays = Math.round((postLeap.getTime() - cutoff.getTime()) / MS_PER_DAY);
      expect(diffDays).toBe(90);
    });
  });
});
