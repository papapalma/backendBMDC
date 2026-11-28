import { z, ZodError } from 'zod';
import { handleError } from '@/middleware/errorHandler';
import { NextRequest } from 'next/server';
import {
  loginSchema,
  registerSchema,
  createProgramSchema,
  createItemSchema,
  updateDetectionConfigSchema,
  traineeStatusFilterSchema,
} from '@/utils/validators';

describe('Zod v4 Standardization & Schema Migration Verification', () => {
  it('should use Zod v4 where error.issues is defined and error.errors is undefined', () => {
    const schema = z.object({
      username: z.string().min(3),
    });

    const result = schema.safeParse({ username: 'ab' });
    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      expect(Array.isArray(result.error.issues)).toBe(true);
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect((result.error as any).errors).toBeUndefined();

      // Safe accessor should extract issues properly
      const safeIssues = result.error.issues || (result.error as any).errors || [];
      expect(safeIssues.length).toBe(result.error.issues.length);
      expect(safeIssues[0].path).toEqual(['username']);
    }
  });

  it('handleError should correctly format Zod v4 errors without throwing', async () => {
    const testSchema = z.object({
      email: z.string().email('Invalid email'),
      count: z.number().min(1, 'Count must be positive'),
    });

    const parseResult = testSchema.safeParse({ email: 'bad-email', count: 0 });
    expect(parseResult.success).toBe(false);

    if (!parseResult.success) {
      const mockReq = new NextRequest('http://localhost:3000/api/test');
      const response = handleError(parseResult.error, mockReq);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Validation failed');
      expect(json.errors).toBeDefined();
      expect(json.errors['email']).toContain('Invalid email');
      expect(json.errors['count']).toContain('Count must be positive');
    }
  });

  describe('Core Schema Verification', () => {
    it('loginSchema parses valid and invalid payloads', () => {
      const valid = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
      });
      expect(valid.success).toBe(true);

      const invalid = loginSchema.safeParse({
        email: 'not-an-email',
        password: 'short',
      });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        const issues = invalid.error.issues || (invalid.error as any).errors || [];
        expect(issues.length).toBeGreaterThan(0);
      }
    });

    it('registerSchema parses valid registration', () => {
      const valid = registerSchema.safeParse({
        email: 'newuser@example.com',
        username: 'valid_user-1',
        password: 'Password123',
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.role).toBe('staff_inventory_manager');
      }
    });

    it('createProgramSchema parses valid program', () => {
      const valid = createProgramSchema.safeParse({
        name: 'Technical Training',
        description: 'A comprehensive technical program',
        duration_weeks: 26,
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: '2026-06-30T00:00:00.000Z',
        type_of_funding: 'Scholarship',
        enrollment_limit: 50,
      });
      expect(valid.success).toBe(true);
    });

    it('createItemSchema parses valid item', () => {
      const valid = createItemSchema.safeParse({
        name: 'Hammer',
        category: 'Tools',
        quantity: 10,
        unit: 'pcs',
        location: 'Warehouse Room A',
      });
      expect(valid.success).toBe(true);
    });

    it('updateDetectionConfigSchema parses 2-arg z.record cleanly', () => {
      const valid = updateDetectionConfigSchema.safeParse({
        config_key: 'custom-config',
        config_value: { threshold: 0.8, enabled: true },
        description: 'Test detection config',
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.config_value).toEqual({ threshold: 0.8, enabled: true });
      }
    });

    it('traineeStatusFilterSchema parses query parameters', () => {
      const valid = traineeStatusFilterSchema.safeParse({
        page: 1,
        limit: 20,
        employment_status: 'employed',
      });
      expect(valid.success).toBe(true);
    });
  });
});
