import { defineConfig } from 'vitest/config'

// Disable project graph cache for tests to ensure clean state between runs
process.env.NX_CACHE_PROJECT_GRAPH = 'false'
process.env.NX_DAEMON = 'false'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
})
