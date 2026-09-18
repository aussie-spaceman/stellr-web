import { describe, expect, it } from 'vitest'
import { PRODUCTION_SUPABASE_REF, productionCredentialIn, refusalMessage } from './production-guard.mjs'

// The shape of a real .env.local, minus anything secret.
const dev = [
  'NEXT_PUBLIC_APP_ENV=dev',
  'NEXT_PUBLIC_SUPABASE_URL=https://xvxlhbxtiwxpopoqjygm.supabase.co',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_abc',
  'CLERK_SECRET_KEY=sk_test_abc',
].join('\n')

describe('productionCredentialIn', () => {
  it('passes a dev .env.local', () => {
    expect(productionCredentialIn(dev)).toBeNull()
  })

  it('passes an empty file', () => {
    expect(productionCredentialIn('')).toBeNull()
  })

  it('trips on the production Supabase ref', () => {
    const text = dev.replace('xvxlhbxtiwxpopoqjygm', PRODUCTION_SUPABASE_REF)
    expect(productionCredentialIn(text)?.name).toBe('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('trips on a pk_live_ Clerk key', () => {
    const text = dev.replace('pk_test_abc', 'pk_live_abc')
    expect(productionCredentialIn(text)?.name).toBe('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
  })

  it('trips on an sk_live_ Stripe secret key', () => {
    const text = dev + '\nSTRIPE_SECRET_KEY=sk_live_abc'
    expect(productionCredentialIn(text)?.name).toBe('STRIPE_SECRET_KEY')
  })

  it('passes an sk_test_ Stripe secret key', () => {
    expect(productionCredentialIn(dev + '\nSTRIPE_SECRET_KEY=sk_test_abc')).toBeNull()
  })

  it('reports Supabase first when both are production', () => {
    const text = dev
      .replace('xvxlhbxtiwxpopoqjygm', PRODUCTION_SUPABASE_REF)
      .replace('pk_test_abc', 'pk_live_abc')
    expect(productionCredentialIn(text)?.name).toBe('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('reads quoted and whitespace-padded values', () => {
    const text = `  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_abc"  `
    expect(productionCredentialIn(text)?.name).toBe('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
  })

  it('ignores the production ref in a comment', () => {
    // .env.local.example carries exactly this comment, explaining why the ref
    // must not be used. A worktree copied from it must still start.
    const text = `# The production ref (${PRODUCTION_SUPABASE_REF}) belongs only in Vercel\n${dev}`
    expect(productionCredentialIn(text)).toBeNull()
  })

  it('ignores a commented-out assignment', () => {
    const text = `# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_abc\n${dev}`
    expect(productionCredentialIn(text)).toBeNull()
  })

  it('does not confuse DATABASE_URL pooler strings with the app URL', () => {
    // PROD_DATABASE_URL legitimately names the production project for
    // `npm run db:status -- --prod`. Only the app's own URL is judged.
    const text = `${dev}\nPROD_DATABASE_URL=postgresql://postgres.${PRODUCTION_SUPABASE_REF}:x@host:5432/postgres`
    expect(productionCredentialIn(text)).toBeNull()
  })
})

describe('refusalMessage', () => {
  it('names the variable, the dev target, and the override', () => {
    const message = refusalMessage({ name: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'names production' })
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL names production')
    expect(message).toContain('xvxlhbxtiwxpopoqjygm')
    expect(message).toContain('ALLOW_PROD_LOCALLY=1')
  })
})
