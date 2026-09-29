/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
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
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  // Provide a test JWT_SECRET so auth utilities don't throw at import time
  setupFiles: ['<rootDir>/jest.setup.ts'],
};

module.exports = config;
