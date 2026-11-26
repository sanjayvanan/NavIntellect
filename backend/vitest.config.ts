import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // DATABASE_URL comes from backend/.env (or TEST_DATABASE_URL); tables go in an isolated schema.
      ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
      DB_SCHEMA: process.env.TEST_DB_SCHEMA ?? 'ais_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      AUTH_REQUIRED_FOR_READS: 'false',
      ALERT_COOLDOWN_MINUTES: '0',
      // Never call the real Gemini API from tests: they use a scripted fake model.
      GEMINI_API_KEY: '',
      AI_DAILY_LIMIT: '1000',
      AI_USER_DAILY_LIMIT: '10',
      AI_RPM: '1000',
      AI_MAX_TOOL_ROUNDS: '3',
    },
  },
});
