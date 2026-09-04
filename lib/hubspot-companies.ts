// Company (account) resolution for the Apollo integration.
//
// A deal with a contact but no company is only half a record: for school and
// district prospecting the organisation *is* the account, and pipeline reporting
// by company is the point of having a CRM at all.
//
// Companies are keyed on **domain**, never on name. Names arrive from Apollo in
// half a dozen spellings of the same district ("Carson City SD", "Carson City
// School District", "CCSD") and matching on them would fan one account out into
// several; the domain is the one stable identifier, and it is what HubSpot's own
// company dedupe uses.
//
// Required env: HUBSPOT_ACCESS_TOKEN with crm.objects.companies.read/write.

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const BASE = 'https://api.hubapi.com'

/**
 * Consumer mailbox providers. A prospect writing from gmail.com must not create
 * a company called "Gmail" that then accumulates every unrelated consumer lead
 * as an employee — one poisoned account that is tedious to unpick later.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'mail.com', 'zoho.com', 'yandex.com', 'comcast.net', 'verizon.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
])

/** Strip protocol, credentials, www., port, path and casing off a domain. */
export function normaliseDomain(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let d = raw.trim().toLowerCase()
  if (!d) return undefined
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  d = d.replace(/^[^/@]*@/, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  d = d.split(':')[0]
  d = d.replace(/^www\./, '')
  d = d.replace(/\.+$/, '')
  if (!d.includes('.') || d.includes(' ')) return undefined
  return d
}

/** The company domain implied by an email address, or undefined if consumer. */
export function domainFromEmail(email: string | undefined): string | undefined {
  if (!email || !email.includes('@')) return undefined
  const d = normaliseDomain(email.split('@').pop())
  if (!d || FREE_EMAIL_DOMAINS.has(d)) return undefined
  return d
}

export function isFreeEmailDomain(domain: string | undefined): boolean {
  return !!domain && FREE_EMAIL_DOMAINS.has(domain)
}

/* ── HubSpot I/O ─────────────────────────────────────────────────────────── */

async function hubspot(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

export async function findCompanyByDomain(domain: string): Promise<string | null> {
  if (!HUBSPOT_ACCESS_TOKEN) return null
  try {
    const res = await hubspot('/crm/v3/objects/companies/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
      properties: ['domain'],
      limit: 1,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { results?: { id: string }[] }
    return json.results?.[0]?.id ?? null
  } catch {
    return null
  }
}

export async function createCompany(input: {
  domain: string
  name?: string
}): Promise<{ ok: boolean; id?: string }> {
  if (!HUBSPOT_ACCESS_TOKEN) return { ok: false }
  try {
    const res = await hubspot('/crm/v3/objects/companies', 'POST', {
      properties: { domain: input.domain, name: input.name || input.domain },
    })
    if (!res.ok) {
      console.error('[hubspot-companies] Create failed', res.status, await res.text())
      return { ok: false }
    }
    const json = (await res.json()) as { id: string }
    return { ok: true, id: json.id }
  } catch (err) {
    console.error('[hubspot-companies] Create threw', err)
    return { ok: false }
  }
}

/**
 * Associate two records using HubSpot's **default** association.
 *
 * Deliberately the v4 `/associations/default/` route rather than posting a
 * hard-coded `associationTypeId`. The numeric ids differ per direction and per
 * label (contact→company is not company→contact, and the "primary" variants are
 * different numbers again); letting HubSpot pick its own default is both
 * correct and immune to us mixing the pair up.
 */
export async function associateDefault(
  fromType: 'contacts' | 'deals',
  fromId: string,
  toType: 'companies',
  toId: string,
): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) return false
  try {
    const res = await hubspot(
      `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
      'PUT',
    )
    if (!res.ok) {
      console.error(
        `[hubspot-companies] Associate ${fromType}:${fromId} → ${toType}:${toId} failed`,
        res.status,
        await res.text(),
      )
      return false
    }
    return true
  } catch (err) {
    console.error('[hubspot-companies] Associate threw', err)
    return false
  }
}

/**
 * Find or create the company for a domain. Returns null for consumer mailboxes
 * and unusable domains — callers treat that as "no account", not as an error,
 * because a personal address is a legitimate way for a prospect to reply.
 */
export async function ensureCompany(input: {
  domain?: string
  name?: string
  email?: string
}): Promise<{ id: string; created: boolean } | null> {
  const domain = normaliseDomain(input.domain) ?? domainFromEmail(input.email)
  if (!domain || isFreeEmailDomain(domain)) return null

  const existing = await findCompanyByDomain(domain)
  if (existing) return { id: existing, created: false }

  const created = await createCompany({ domain, name: input.name })
  return created.ok && created.id ? { id: created.id, created: true } : null
}
