/**
 * READ-ONLY production verification for Stripe + DocuSign.
 *
 * Makes live, read-only API calls using whatever credentials are in .env.local:
 *   • Stripe  — confirms key mode, then retrieves every price ID stored in
 *               membership_tiers / session_entitlements and reports livemode +
 *               active. This catches the "live key + test-mode price ID" trap
 *               that 400s real checkouts.
 *   • DocuSign — reports sandbox vs production endpoints, performs JWT auth, and
 *               retrieves each configured template by ID to confirm it exists.
 *
 * No writes, no envelopes sent, no charges. Safe to run.
 *
 *   npx tsx scripts/verify-prod-services.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createSign } from 'crypto'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const ok = (s: string) => `✅ ${s}`
const bad = (s: string) => `❌ ${s}`
const warn = (s: string) => `⚠️  ${s}`

// ── Stripe ─────────────────────────────────────────────────────────────────
async function checkStripe() {
  console.log('\n══════════ STRIPE ══════════')
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) { console.log(bad('STRIPE_SECRET_KEY not set')); return }

  const mode = key.startsWith('sk_live') ? 'LIVE' : key.startsWith('sk_test') ? 'TEST' : 'UNKNOWN'
  console.log(`key mode: ${mode}`)
  const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })

  // Validate the key works at all.
  try {
    const acct = await stripe.accounts.retrieve(null) // null id → account for the API key
    console.log(ok(`key valid — account ${acct.id} (${acct.settings?.dashboard?.display_name ?? 'n/a'})`))
  } catch (e: any) {
    console.log(bad(`key rejected by Stripe: ${e.message}`))
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc) { console.log(warn('Supabase env missing — cannot read DB price IDs')); return }
  const db = createClient(url, svc, { auth: { persistSession: false } })

  // Gather every price ID referenced in the DB.
  const priceRefs: { label: string; id: string }[] = []
  const { data: tiers } = await db
    .from('membership_tiers')
    .select('name, is_free, stripe_price_id, stripe_price_id_monthly')
  for (const t of tiers ?? []) {
    if (t.is_free) continue
    if (t.stripe_price_id) priceRefs.push({ label: `${t.name} (annual)`, id: t.stripe_price_id })
    if (t.stripe_price_id_monthly) priceRefs.push({ label: `${t.name} (monthly)`, id: t.stripe_price_id_monthly })
  }
  const { data: ents } = await db
    .from('session_entitlements')
    .select('session_type, extra_stripe_price_id')
  for (const e of ents ?? []) {
    if (e.extra_stripe_price_id) priceRefs.push({ label: `session: ${e.session_type}`, id: e.extra_stripe_price_id })
  }

  if (priceRefs.length === 0) {
    console.log(warn('No paid price IDs found in membership_tiers / session_entitlements'))
    return
  }

  console.log(`\nResolving ${priceRefs.length} price ID(s) against the ${mode} key:`)
  let allGood = true
  for (const ref of priceRefs) {
    try {
      const p = await stripe.prices.retrieve(ref.id)
      const amt = p.unit_amount != null ? `${(p.unit_amount / 100).toFixed(2)} ${p.currency.toUpperCase()}` : 'n/a'
      const live = p.livemode ? 'live' : 'TEST'
      const flag = p.livemode && p.active ? ok('') : warn('')
      if (!(p.livemode && p.active)) allGood = false
      console.log(`  ${flag}${ref.label}: ${ref.id} → ${live}, ${p.active ? 'active' : 'INACTIVE'}, ${amt}`)
    } catch (e: any) {
      allGood = false
      console.log(`  ${bad('')}${ref.label}: ${ref.id} → NOT FOUND under ${mode} key (${e.code ?? e.message})`)
      if (mode === 'LIVE') console.log(`       ↳ likely a TEST-mode price ID — live checkout will fail until this row holds a live price.`)
    }
  }
  console.log(allGood
    ? ok('All DB price IDs are live + active — Stripe checkout is production-ready.')
    : bad('One or more price IDs are not live/active — fix before go-live.'))
}

// ── DocuSign ─────────────────────────────────────────────────────────────────
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function checkDocuSign() {
  console.log('\n══════════ DOCUSIGN ══════════')
  const oauthUrl = process.env.DOCUSIGN_OAUTH_URL ?? 'https://account-d.docusign.com'
  const basePath = process.env.DOCUSIGN_BASE_PATH ?? 'https://demo.docusign.net/restapi'
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID ?? ''
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY ?? ''
  const userId = process.env.DOCUSIGN_USER_ID ?? ''
  const privateKey = (process.env.DOCUSIGN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')

  const isProd = oauthUrl.includes('account.docusign.com') && !oauthUrl.includes('account-d')
  console.log(`oauth:     ${oauthUrl}`)
  console.log(`base path: ${basePath}`)
  console.log(`environment: ${isProd ? 'PRODUCTION' : 'SANDBOX / DEMO'}`)
  // This line printed "SANDBOX / DEMO" correctly for three months while real
  // families signed non-binding demo documents, because nobody ran the script
  // and the output was just informational. Say what it MEANS, not just what it is.
  if (!isProd) {
    console.log(bad('Envelopes issued from here are stamped "DEMONSTRATION DOCUMENT ONLY" and are NOT binding signatures.'))
    console.log('       ↳ go-live steps: docs/GO-LIVE-CHECKLIST.md §4a')
  }

  if (!integrationKey || !userId || !privateKey || !accountId) {
    console.log(bad('Missing DocuSign credentials — cannot auth.'))
    return
  }

  // JWT auth — mirrors lib/docusign.ts getAccessToken().
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: integrationKey, sub: userId, aud: oauthUrl.replace('https://', ''),
    iat: now, exp: now + 3600, scope: 'signature impersonation',
  })))
  const input = `${header}.${payload}`
  let token: string
  try {
    const sign = createSign('RSA-SHA256'); sign.update(input)
    const jwt = `${input}.${base64url(sign.sign(privateKey))}`
    const res = await fetch(`${oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })
    const bodyText = await res.text()
    if (!res.ok) {
      console.log(bad(`JWT auth failed: ${bodyText}`))
      if (bodyText.includes('consent_required')) {
        const consent = `${oauthUrl}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${integrationKey}&redirect_uri=https://www.docusign.com`
        console.log(`       ↳ grant consent once: ${consent}`)
      }
      return
    }
    token = (JSON.parse(bodyText) as { access_token: string }).access_token
    console.log(ok('JWT auth succeeded.'))
  } catch (e: any) {
    console.log(bad(`JWT auth error: ${e.message}`))
    return
  }

  // Retrieve each configured template by ID.
  // The volunteer template has never existed: DOCUSIGN_VOLUNTEER_TEMPLATE_ID is
  // unset in Vercel and no such template exists in the account, so
  // createVolunteerAgreementEnvelope() throws for every volunteer. It was
  // missing from this list too, which is why nothing ever reported it.
  const templates = [
    { label: 'minor/guardian consent', id: process.env.DOCUSIGN_TEMPLATE_ID },
    { label: 'adult agreement', id: process.env.DOCUSIGN_ADULT_TEMPLATE_ID },
    { label: 'mentor agreement', id: process.env.DOCUSIGN_MENTOR_TEMPLATE_ID },
    { label: 'volunteer agreement', id: process.env.DOCUSIGN_VOLUNTEER_TEMPLATE_ID },
  ]
  console.log('\nTemplates:')
  for (const t of templates) {
    if (!t.id) { console.log(`  ${bad('')}${t.label}: env not set — this agreement type CANNOT be issued`); continue }
    try {
      const res = await fetch(`${basePath}/v2.1/accounts/${accountId}/templates/${t.id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const tpl = await res.json() as { name?: string }
        console.log(`  ${ok('')}${t.label}: ${t.id} → "${tpl.name ?? '(unnamed)'}"`)
      } else {
        console.log(`  ${bad('')}${t.label}: ${t.id} → ${res.status} ${await res.text()}`)
      }
    } catch (e: any) {
      console.log(`  ${bad('')}${t.label}: ${t.id} → ${e.message}`)
    }
  }
}

// ── Analytics (GTM) ───────────────────────────────────────────────────────────
// Confirms the Google Tag Manager container is deployed on BOTH subdomains.
//
// What this checks and why: the GTM loader is a next/script `afterInteractive`
// tag that Next injects CLIENT-SIDE after hydration, so it is NOT in server HTML
// and cannot be seen by fetch/curl — a "no gtm.js in the HTML" result is a false
// negative. The reliable server-visible proof that NEXT_PUBLIC_GTM_ID was baked
// into the build is the <noscript> fallback iframe, which the root layout (a
// server component) renders only when the env var is set. That's what we assert.
// Full runtime confirmation (dataLayer + google_tag_manager[ID]) needs a browser
// — the console snippet below does it in one paste.
async function checkAnalytics() {
  console.log('\n══════════ ANALYTICS (GTM) ══════════')
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID || 'GTM-WXBRWSH'
  console.log(`expected container: ${gtmId}`)
  console.log(warn('loader is afterInteractive (client-injected) — HTML checks the <noscript> proxy only'))

  // Same container serves www + app (subdomain-shared layout). Deep-link to a
  // stable, always-rendered page on each so we get real HTML, not a redirect.
  const targets = [
    { label: 'www', url: 'https://www.stellreducation.org/' },
    { label: 'app', url: 'https://app.stellreducation.org/sign-in' },
  ]

  let allGood = true
  for (const t of targets) {
    try {
      const res = await fetch(t.url, { redirect: 'follow' })
      const html = await res.text()
      const hasNoscript = new RegExp(`ns\\.html\\?id=${gtmId}`, 'i').test(html)
      if (hasNoscript) {
        console.log(`  ${ok('')}${t.label} (${t.url}): <noscript id=${gtmId}> present → env var baked into build`)
      } else {
        allGood = false
        console.log(`  ${bad('')}${t.label} (${t.url}): no <noscript id=${gtmId}> → NEXT_PUBLIC_GTM_ID unset at build, or not redeployed since it was set`)
      }
    } catch (e: any) {
      allGood = false
      console.log(`  ${bad('')}${t.label} (${t.url}): fetch failed — ${e.message}`)
    }
  }

  console.log(allGood
    ? ok(`GTM ${gtmId} is deployed on both subdomains.`)
    : bad(`GTM not confirmed on one or more subdomains — see above.`))
  console.log('  Runtime check (paste in the browser console on each domain):')
  console.log(`    JSON.stringify({dl:typeof dataLayer!=='undefined',gtm:!!(window.google_tag_manager&&google_tag_manager['${gtmId}']),src:(document.querySelector('script[src*="gtm.js"]')||{}).src})`)
}

async function main() {
  console.log('READ-ONLY production verification (no writes / no charges / no envelopes)')
  await checkStripe()
  await checkDocuSign()
  await checkAnalytics()
  console.log('\nDone.')
}

main().catch((e) => { console.error('Unexpected error:', e); process.exit(1) })
