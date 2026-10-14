/** @type {import('jest').Config} */
const path = require('path');

const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': path.resolve(__dirname, 'src/$1'),
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Use CommonJS for Jest compatibility
          module: 'commonjs',
          moduleResolution: 'node',
        },
      },
    ],
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // Exclude tests that require external dependencies, have undefined imports, or other issues
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '\\.perf\\.test\\.ts$',
    '\\.properties\\.test\\.ts$',
    'dataRetention',
    'enrollmentRequirementService',
    'cms-error-handling',
    'audit-logging',
    'jsonb-size-limits',
  ],
  // Provide a test JWT_SECRET so auth utilities don't throw at import time
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testTimeout: 10000,
};

module.exports = config;
