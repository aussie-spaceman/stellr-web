import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Stellr signing test agreements, made fresh for each spec and removed after.
 *
 * Not a seed fixture: signing consumes the agreement (links retire, the record
 * seals), so a shared row would only work once. Each test issues its own with
 * the real provider code, against the dev database the suite already uses.
 *
 * Issuing sends no email: ./esign-cli.ts drops the Resend key before the mail
 * module loads, and the test mints each signer's link itself. The server still
 * mails the student's invitation and the completion notices when the page
 * drives those steps; outside production lib/email routes them to the safelist
 * address, and in CI there is no Resend key at all.
 */

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

export function esignConfigured(): boolean {
  return (process.env.ESIGN_TOKEN_SECRET ?? '').length >= 32
}

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  // The suite never runs against production; this file refuses to even try.
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`esign e2e fixtures only run against the dev project (${DEV_PROJECT_REF})`)
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
}

export interface TestAgreement {
  rowId: string
  /** Recipient row ids in signing order. */
  signers: { id: string; role: string }[]
  birthYear: string
  guardianName: string
  studentName: string
}

function cli<T>(...args: string[]): T {
  // The issuing code imports app modules through `@/` aliases, which tsx
  // resolves and Playwright's loader does not. Output is the last stdout line.
  const out = execFileSync('npx', ['tsx', 'e2e/fixtures/esign-cli.ts', ...args], { encoding: 'utf8', env: process.env })
  return JSON.parse(out.trim().split('\n').at(-1) as string) as T
}

export async function issueMinorAgreement(): Promise<TestAgreement> {
  return cli<TestAgreement>('issue-minor')
}

/** The signer's current link, as their email would carry it. */
export async function signingPath(recipientId: string): Promise<string> {
  return cli<string>('link', recipientId)
}

/** The confirmation link for the newest privacy request from this address. */
export async function privacyConfirmPath(email: string): Promise<string> {
  return cli<string>('privacy-link', email)
}

export async function removePrivacyRequests(email: string): Promise<void> {
  await db().from('privacy_requests').delete().eq('requester_email', email)
}

export async function readAgreement(rowId: string) {
  const client = db()
  const [{ data: envelope }, { data: recipients }, { data: brokenAt }] = await Promise.all([
    client.from('agreements').select('*').eq('id', rowId).single(),
    client.from('agreement_recipients').select('*').eq('envelope_row', rowId).order('routing_order'),
    client.rpc('esign_verify_audit', { p_envelope: rowId }),
  ])
  const { data: events } = await client
    .from('esign_audit_events')
    .select('event, detail')
    .eq('envelope_row', rowId)
    .order('id')
  return { envelope, recipients: recipients ?? [], events: events ?? [], chainBrokenAt: brokenAt as number | null }
}

/** Everything the agreement left behind: audit trail, stored files, rows. */
export async function removeAgreement(rowId: string): Promise<void> {
  const client = db()
  const { data: row } = await client
    .from('agreements')
    .select('signed_pdf_path, certificate_path')
    .eq('id', rowId)
    .maybeSingle()
  const paths = [row?.signed_pdf_path, row?.certificate_path].filter(Boolean) as string[]
  if (paths.length) await client.storage.from('signed-agreements').remove(paths)
  await client.rpc('esign_purge_audit', { p_envelope: rowId })
  await client.from('esign_access_log').delete().eq('envelope_row', rowId)
  await client.from('agreement_recipients').delete().eq('envelope_row', rowId)
  await client.from('agreements').delete().eq('id', rowId)
}
