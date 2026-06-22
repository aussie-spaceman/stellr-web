// Minimal HubSpot CRM client for capturing website leads (white-paper download,
// newsletter, etc.) into the marketing CRM. Uses a private-app access token.
//
// Set HUBSPOT_ACCESS_TOKEN to a HubSpot private-app token with the
// `crm.objects.contacts.write` scope. Without it, every call is a logged no-op
// so local/preview builds never fail on a missing secret.

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const BASE = 'https://api.hubapi.com'

export interface UpsertContactInput {
  email: string
  firstName?: string
  lastName?: string
  /** Free-text note recorded on the contact (e.g. which asset they requested). */
  note?: string
  /** HubSpot lifecycle stage; defaults to 'lead'. */
  lifecycleStage?: string
}

type Props = Record<string, string>

async function hubspot(path: string, method: 'POST' | 'PATCH', props: Props) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: props }),
  })
}

/**
 * Create or update a HubSpot contact, keyed on email. Best-effort: returns
 * `{ ok }` and never throws, so a CRM hiccup can't block the user from getting
 * their download. If an optional property (e.g. `message`) isn't defined in the
 * portal, it retries with only the core identity fields rather than losing the
 * lead.
 */
export async function upsertContact(input: UpsertContactInput): Promise<{ ok: boolean }> {
  if (!HUBSPOT_ACCESS_TOKEN) {
    console.log('[hubspot] No HUBSPOT_ACCESS_TOKEN — would have upserted contact:', input.email)
    return { ok: false }
  }

  const core: Props = { email: input.email }
  if (input.firstName) core.firstname = input.firstName
  if (input.lastName) core.lastname = input.lastName

  const full: Props = {
    ...core,
    lifecyclestage: input.lifecycleStage ?? 'lead',
    ...(input.note ? { message: input.note } : {}),
  }

  const emailId = encodeURIComponent(input.email)

  // Try update-by-email first (idempotent for repeat downloads), fall back to
  // create when the contact doesn't exist yet.
  async function write(props: Props): Promise<Response> {
    const updated = await hubspot(`/crm/v3/objects/contacts/${emailId}?idProperty=email`, 'PATCH', props)
    if (updated.status !== 404) return updated
    return hubspot('/crm/v3/objects/contacts', 'POST', props)
  }

  try {
    let res = await write(full)
    // A 400 usually means an optional property (e.g. `message`) isn't defined in
    // this portal — retry with just the identity fields so the lead still lands.
    if (res.status === 400) {
      res = await write(core)
    }
    if (!res.ok) {
      console.error('[hubspot] Contact upsert failed', res.status, await res.text())
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error('[hubspot] Contact upsert error:', err)
    return { ok: false }
  }
}
