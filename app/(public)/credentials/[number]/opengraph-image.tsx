import { ImageResponse } from 'next/og'
import { supabaseServer } from '@/lib/supabase'
import { tokens } from '@/lib/tokens'
import {
  ageBlock,
  credentialState,
  normaliseCredentialNumber,
  type CredentialStatus,
  type CredentialTheme,
  type CredentialVisibility,
} from '@/lib/credentials-core'
import { badgeAccent, BadgeGlyph } from './badge/glyph'

/**
 * The share card: what a LinkedIn feed post (or Slack, or iMessage) shows for
 * a credential URL. This is the only place the badge graphic reaches
 * LinkedIn — the profile entry itself carries no image, just the Stellr Page
 * logo — so the card is the badge, the title and the name, nothing else.
 *
 * Edge, not Node, for the same reason as lp/[slug]/opengraph-image.tsx: the
 * Node ImageResponse drags sharp into the page's lambda. That is also why
 * this file imports lib/credentials-core (pure) and not lib/credentials.
 *
 * Private, revoked and withdrawn credentials get a generic card with no name:
 * the scraper is not the owner, and a stale preview must not out a page that
 * has since been turned off.
 */
export const runtime = 'edge'

export const alt = 'Stellr Education verified credential'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * deep review MP-12: the card carries a (possibly minor's) name, so it must not
 * be cached as `public, immutable, max-age=31536000` (the @vercel/og default) —
 * that keeps a name card alive in browser, proxy and unfurler caches for a year
 * after the page is unpublished, tombstoned or erased. `private, no-store` means
 * caches re-fetch and so reflect the current state (matching the `privateLink`
 * header stamped on `/credentials/*` in next.config). An edge card is cheap to
 * regenerate.
 */
export const OG_CACHE_CONTROL = 'private, no-store'

interface OgRow {
  number: string
  recipient_name: string
  title: string
  issuer: string
  theme: CredentialTheme | null
  status: CredentialStatus
  expires_at: string | null
  tombstoned_at: string | null
  visibility: CredentialVisibility
  /** The live DOB from the linked member/participant, for the age re-check. */
  date_of_birth: string | null
}

type OgCard = { recipient_name: string; title: string; issuer: string; theme: CredentialTheme | null; number: string }

/**
 * The named card's fields, or null when the name must be withheld. Pure, so the
 * gate is unit-tested without rendering an image.
 *
 * deep review MP-4: the name shows only on a public, non-withdrawn credential
 * whose holder is not (now) under 13 or of unknown age — re-checked from the
 * live DOB on every render, not just when the owner first turned sharing on. A
 * guardian opt-out / withdrawal already flips `visibility` to private (handled
 * by the visibility check); the DOB re-check closes the "DOB corrected to
 * under-13 while still public" gap without pulling DocuSign into the edge card.
 */
export function ogCardFor(data: OgRow | null, now = new Date()): OgCard | null {
  if (!data) return null
  if (data.visibility !== 'public') return null
  if (credentialState(data, now) === 'withdrawn') return null
  if (ageBlock(data.date_of_birth, now)) return null
  return { recipient_name: data.recipient_name, title: data.title, issuer: data.issuer, theme: data.theme, number: data.number }
}

/** A joined row's field is either the object or a one-element array. */
function dobOf(v: unknown): string | null {
  const one = (Array.isArray(v) ? v[0] : v) as { date_of_birth?: string | null } | null | undefined
  return one?.date_of_birth ?? null
}

export default async function Image({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  const n = normaliseCredentialNumber(decodeURIComponent(number))

  let card: OgCard | null = null
  if (n) {
    const { data } = await supabaseServer()
      .from('credentials')
      .select(
        'number, recipient_name, title, issuer, theme, status, expires_at, tombstoned_at, visibility, members!credentials_member_id_fkey(date_of_birth), participants(date_of_birth)',
      )
      .eq('number', n)
      .maybeSingle()
    if (data) {
      const row = data as Record<string, unknown>
      card = ogCardFor({
        number: row.number as string,
        recipient_name: row.recipient_name as string,
        title: row.title as string,
        issuer: row.issuer as string,
        theme: (row.theme as CredentialTheme | null) ?? null,
        status: row.status as CredentialStatus,
        expires_at: (row.expires_at as string | null) ?? null,
        tombstoned_at: (row.tombstoned_at as string | null) ?? null,
        visibility: row.visibility as CredentialVisibility,
        date_of_birth: dobOf(row.members) ?? dobOf(row.participants),
      })
    }
  }

  const accent = badgeAccent(card?.theme ?? null)
  const title = card?.title ?? 'Verified credential'
  const holder = card ? card.recipient_name : 'Issued by Stellr Education'
  const issuer = card?.issuer ?? 'Stellr Education'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 64,
          padding: '64px 80px',
          background: `linear-gradient(180deg, ${tokens.color.midnight}, ${tokens.color.midnightDeep})`,
          color: tokens.color.white,
          fontFamily: 'sans-serif',
        }}
      >
        <BadgeGlyph size={340} accent={accent} />

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: accent }} />
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: tokens.color.heroDim }}>
              Verified credential
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ fontSize: title.length > 40 ? 48 : 60, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.2 }}>
              {title}
            </div>
            <div style={{ fontSize: 34, fontWeight: 600, color: accent, lineHeight: 1.2 }}>{holder}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 22, color: tokens.color.heroLead }}>
            <div>{issuer}</div>
            <div>{card ? `stellreducation.org/credentials/${card.number}` : 'stellreducation.org'}</div>
          </div>
        </div>
      </div>
    ),
    { ...size, headers: { 'Cache-Control': OG_CACHE_CONTROL } },
  )
}
