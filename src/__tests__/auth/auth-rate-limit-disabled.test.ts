import { checkRateLimit, isAuthRateLimitDisabled, isRateLimitDisabled, resetRateLimitStore } from '@/utils/rateLimit';

describe('Global & Authentication Rate Limit Env Control', () => {
  const originalGlobal = process.env.DISABLE_RATE_LIMIT;
  const originalAuth = process.env.DISABLE_AUTH_RATE_LIMIT;

  afterEach(() => {
    resetRateLimitStore();
    if (originalGlobal === undefined) {
      delete process.env.DISABLE_RATE_LIMIT;
    } else {
      process.env.DISABLE_RATE_LIMIT = originalGlobal;
    }
    if (originalAuth === undefined) {
      delete process.env.DISABLE_AUTH_RATE_LIMIT;
    } else {
      process.env.DISABLE_AUTH_RATE_LIMIT = originalAuth;
    }
  });

  describe('isRateLimitDisabled() / isAuthRateLimitDisabled()', () => {
    it('should return true by default when env vars are not set', () => {
      delete process.env.DISABLE_RATE_LIMIT;
      delete process.env.DISABLE_AUTH_RATE_LIMIT;
      expect(isRateLimitDisabled()).toBe(true);
      expect(isAuthRateLimitDisabled()).toBe(true);
    });

    it('should return true when DISABLE_RATE_LIMIT is "true"', () => {
      process.env.DISABLE_RATE_LIMIT = 'true';
      process.env.DISABLE_AUTH_RATE_LIMIT = 'false';
      expect(isRateLimitDisabled()).toBe(true);
      expect(isAuthRateLimitDisabled()).toBe(true);
    });

    it('should return false when DISABLE_RATE_LIMIT is "false"', () => {
      process.env.DISABLE_RATE_LIMIT = 'false';
      delete process.env.DISABLE_AUTH_RATE_LIMIT;
      expect(isRateLimitDisabled()).toBe(false);
      expect(isAuthRateLimitDisabled()).toBe(false);
    });

    it('should fall back to legacy DISABLE_AUTH_RATE_LIMIT when DISABLE_RATE_LIMIT is unset', () => {
      delete process.env.DISABLE_RATE_LIMIT;
      process.env.DISABLE_AUTH_RATE_LIMIT = 'true';
      expect(isAuthRateLimitDisabled()).toBe(true);

      process.env.DISABLE_AUTH_RATE_LIMIT = 'false';
      expect(isAuthRateLimitDisabled()).toBe(false);
    });
  });

  describe('checkRateLimit() env gating', () => {
    it('bypasses all rate limiting when DISABLE_RATE_LIMIT is not "false"', () => {
      process.env.DISABLE_RATE_LIMIT = 'true';
      for (let i = 0; i < 20; i++) {
        expect(checkRateLimit('submit:tenant-1:trainee-1', { limit: 5, windowMs: 60_000 })).toBeNull();
      }
    });

    it('enforces rate limiting and returns NextResponse 429 when DISABLE_RATE_LIMIT is "false"', () => {
      process.env.DISABLE_RATE_LIMIT = 'false';
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit('submit:tenant-1:trainee-2', { limit: 5, windowMs: 60_000 })).toBeNull();
      }
      const blocked = checkRateLimit('submit:tenant-1:trainee-2', { limit: 5, windowMs: 60_000 });
      expect(blocked?.status).toBe(429);
      expect(blocked?.headers.get('Retry-After')).toBeTruthy();
    });
  });
});
