// Jest setup file
// Set up environment variables needed for tests

process.env.JWT_SECRET = 'test-secret-key-for-jest-only-not-for-production';
process.env.JWT_EXPIRES_IN = '15m'; // Task 24: JWT Token Refresh Strategy - short-lived access tokens
process.env.REFRESH_TOKEN_EXPIRES_DAYS = '7'; // Task 24: 7-day refresh token validity
process.env.FRONTEND_URL = 'http://localhost:3001';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key-for-jest-only';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-for-jest-only';

// File encryption key (Task 10: Selfie Encryption at Rest)
// 256-bit key in hex format (32 bytes = 64 hex characters)
process.env.FILE_ENCRYPTION_KEY = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
process.env.FILE_ENCRYPTION_ENABLED = 'true';
