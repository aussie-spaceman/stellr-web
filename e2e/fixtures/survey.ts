import { execFileSync } from 'node:child_process'

/**
 * Post-event survey test events, made fresh for each spec and removed after.
 * The work happens in ./survey-cli.ts under tsx (it needs the app's modules).
 */
function cli<T>(...args: string[]): T {
  const out = execFileSync('npx', ['tsx', 'e2e/fixtures/survey-cli.ts', ...args], { encoding: 'utf8', env: process.env })
  return JSON.parse(out.trim().split('\n').at(-1) as string) as T
}

export function surveyConfigured(): boolean {
  return (process.env.SURVEY_TOKEN_SECRET ?? process.env.ESIGN_TOKEN_SECRET ?? '').length >= 32
}

export const createSurveyEvent = (open: boolean) => cli<{ slug: string; distributionId: string }>('create', ...(open ? ['--open'] : []))
export const surveyPath = (slug: string, firstName: string) => cli<string>('link', slug, firstName)
export const removeSurveyEvent = (slug: string) => cli<boolean>('remove', slug)
