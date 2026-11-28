import { z, ZodError } from 'zod';
import { handleError } from '@/middleware/errorHandler';
import { NextRequest } from 'next/server';
import {
  createTraineeSchema,
  updateDetectionConfigSchema,
  changePasswordSchema,
  completePasswordResetSchema,
  registerSchema,
  loginSchema,
} from '@/utils/validators';

describe('Adversarial Zod v4 Interoperability & Edge Cases', () => {
  describe('ZodError Shape and Legacy Fallback', () => {
    it('verifies Zod v4 native error only has .issues, .errors is undefined', () => {
      const schema = z.object({ code: z.number().positive() });
      const parsed = schema.safeParse({ code: -5 });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error).toBeInstanceOf(ZodError);
        expect(Array.isArray(parsed.error.issues)).toBe(true);
        expect((parsed.error as any).errors).toBeUndefined();
        
        // Non-breaking fallback accessor
        const issues = parsed.error.issues || (parsed.error as any).errors || [];
        expect(issues.length).toBe(1);
        expect(issues[0].path).toEqual(['code']);
      }
    });

    it('verifies fallback accessor works if a legacy mock object only has .errors', () => {
      const mockLegacyError = {
        name: 'ZodError',
        errors: [{ path: ['legacy_field'], message: 'Legacy error' }],
      };
      const issues = (mockLegacyError as any).issues || (mockLegacyError as any).errors || [];
      expect(issues.length).toBe(1);
      expect(issues[0].message).toBe('Legacy error');
    });

    it('verifies fallback accessor handles completely empty or null issues/errors without throwing', () => {
      const emptyError = { name: 'ZodError' };
      const issues = (emptyError as any).issues || (emptyError as any).errors || [];
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.length).toBe(0);
    });
  });

  describe('handleError with Deep and Complex Paths', () => {
    it('handles root-level errors (empty path array)', async () => {
      const schema = z.string().refine(() => false, { message: 'Root validation error' });
      const parsed = schema.safeParse(123);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const mockReq = new NextRequest('http://localhost:3000/api/test');
        const res = handleError(parsed.error, mockReq);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('Validation failed');
        expect(data.errors).toBeDefined();
        // Path join of [] is ''
        expect(data.errors[''] || data.errors['root']).toBeDefined();
      }
    });

    it('handles deeply nested object and array paths without throwing', async () => {
      const deepSchema = z.object({
        users: z.array(
          z.object({
            profile: z.object({
              address: z.object({
                zip: z.string().regex(/^\d{5}$/, 'Invalid zip'),
              }),
            }),
          })
        ),
      });

      const parsed = deepSchema.safeParse({
        users: [
          { profile: { address: { zip: '12345' } } },
          { profile: { address: { zip: 'bad-zip' } } },
        ],
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const mockReq = new NextRequest('http://localhost:3000/api/test');
        const res = handleError(parsed.error, mockReq);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.errors['users.1.profile.address.zip']).toContain('Invalid zip');
      }
    });
  });

  describe('Zod v4 API Method Behavior in Backend Schemas', () => {
    it('updateDetectionConfigSchema: z.record(z.string(), z.unknown()) handles complex records', () => {
      const validPayloads = [
        { config_key: 'key1', config_value: {} },
        { config_key: 'key2', config_value: { a: 1, b: 'str', c: [1, 2], d: { nested: true } } },
        { config_key: 'key3', config_value: { nullVal: null } },
      ];

      for (const payload of validPayloads) {
        const parsed = updateDetectionConfigSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
      }

      // Rejects non-string keys if passed or non-record
      const invalidParsed = updateDetectionConfigSchema.safeParse({
        config_key: 'key4',
        config_value: 'not-an-object',
      });
      expect(invalidParsed.success).toBe(false);
    });

    it('createTraineeSchema: preprocessed enums handle mixed casing and whitespace', () => {
      const validPartial = {
        first_name: 'Juan',
        middle_name: 'Santos',
        last_name: 'Dela Cruz',
        email: 'juan@example.com',
        phone: '09123456789',
        sex: 'female', // lowercase should preprocess to 'Female'
        birth_date: '2000-01-01',
        birth_place: 'Manila',
        civil_status: 'single', // lowercase should preprocess to 'Single'
        province: 'Metro Manila',
        municipality: 'Manila',
        barangay: 'Barangay 1',
        street: 'Main St',
        educational_attainment: 'College',
        course: 'Computer Science',
        year_graduated: '2022',
        classification: 'Student',
        employment_status: 'Unemployed',
      };

      const parsed = createTraineeSchema.safeParse(validPartial);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sex).toBe('Female');
        expect(parsed.data.civil_status).toBe('Single');
      }

      // Invalid enum message check
      const invalidEnum = createTraineeSchema.safeParse({
        ...validPartial,
        sex: 'other',
      });
      expect(invalidEnum.success).toBe(false);
      if (!invalidEnum.success) {
        const issues = invalidEnum.error.issues || (invalidEnum.error as any).errors || [];
        expect(issues.some((i: any) => i.path.includes('sex'))).toBe(true);
      }
    });

    it('password schemas: changePasswordSchema and completePasswordResetSchema enforce 6 char minimum', () => {
      const validChange = changePasswordSchema.safeParse({
        currentPassword: 'oldPassword1',
        newPassword: 'Valid1@', // 6 characters
        confirmPassword: 'Valid1@',
      });
      expect(validChange.success).toBe(true);

      const tooShortChange = changePasswordSchema.safeParse({
        currentPassword: 'oldPassword1',
        newPassword: 'Val1@', // 5 characters
        confirmPassword: 'Val1@',
      });
      expect(tooShortChange.success).toBe(false);

      const validReset = completePasswordResetSchema.safeParse({
        email: 'user@test.com',
        otp: '123456',
        newPassword: 'Valid1@', // 6 characters
        resetToken: 'valid-reset-token-minimum-20-chars',
      });
      expect(validReset.success).toBe(true);
    });
  });
});
