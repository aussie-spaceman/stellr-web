/**
 * READ-ONLY web-store config check (PRD §12, Phase 0).
 *
 * Confirms the store env vars are present and, if Printful is configured, makes
 * one read-only call to list sync products so you know the token + store id are
 * valid before wiring up checkout. No writes, no orders.
 *
 *   npx tsx scripts/verify-store.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { listSyncProducts, printfulEnabled } from '../lib/store/printful'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function report(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log('Web store config check\n')

  report('PRINTFUL_API_KEY', Boolean(process.env.PRINTFUL_API_KEY))
  report('PRINTFUL_STORE_ID', Boolean(process.env.PRINTFUL_STORE_ID), '(optional with a store-level token)')
  report('PRINTFUL_WEBHOOK_SECRET', Boolean(process.env.PRINTFUL_WEBHOOK_SECRET))
  report('STRIPE_SECRET_KEY (reused)', Boolean(process.env.STRIPE_SECRET_KEY))

  if (!printfulEnabled()) {
    console.log('\nPrintful not configured — skipping live catalog check.')
    return
  }

  try {
    const products = await listSyncProducts()
    report('Printful catalog reachable', true, `${products.length} sync product(s)`)
    for (const p of products.slice(0, 10)) {
      console.log(`    • ${p.name} (${p.variants} variant${p.variants === 1 ? '' : 's'})`)
    }
  } catch (err) {
    report('Printful catalog reachable', false, (err as Error).message)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
