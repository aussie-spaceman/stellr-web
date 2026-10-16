import { defineConfig, devices } from '@playwright/test'

/**
 * Story checks (mobile review G5): every Storybook story renders at phone width
 * without a page error, and axe finds no serious or critical WCAG 2.2 AA issue.
 *
 *   npm run build-storybook && npx http-server storybook-static -p 6006
 *   npm run test:storybook
 *
 * Its own config: it needs no app server, no sign-in and no global setup.
 * (Storybook's own test runner can't load its config under Storybook 10, whose
 * module loader registers a Node hook that the runner's Jest refuses.)
 */
export default defineConfig({
  testDir: './e2e/storybook',
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { baseURL: process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006' },
  projects: [{ name: 'stories', use: { ...devices['Pixel 7'] } }],
})
