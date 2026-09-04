// Jest setup file
// Set up environment variables needed for tests

process.env.JWT_SECRET = 'test-secret-key-for-jest-only-not-for-production';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key-for-jest-only';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-for-jest-only';
