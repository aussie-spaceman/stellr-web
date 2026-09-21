import { ImageResponse } from 'next/og'
import { supabaseServer } from '@/lib/supabase'
import { tokens } from '@/lib/tokens'
import { credentialState, normaliseCredentialNumber, type CredentialTheme } from '@/lib/credentials-core'
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

export default async function Image({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  const n = normaliseCredentialNumber(decodeURIComponent(number))

  let cred: { recipient_name: string; title: string; issuer: string; theme: CredentialTheme | null; number: string } | null = null
  if (n) {
    const { data } = await supabaseServer()
      .from('credentials')
      .select('number, recipient_name, title, issuer, theme, status, expires_at, tombstoned_at, visibility')
      .eq('number', n)
      .maybeSingle()
    if (data && data.visibility === 'public' && credentialState(data) !== 'withdrawn') {
      cred = { recipient_name: data.recipient_name, title: data.title, issuer: data.issuer, theme: data.theme, number: data.number }
    }
  }

  const accent = badgeAccent(cred?.theme ?? null)
  const title = cred?.title ?? 'Verified credential'
  const holder = cred ? cred.recipient_name : 'Issued by Stellr Education'
  const issuer = cred?.issuer ?? 'Stellr Education'

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
            <div>{cred ? `stellreducation.org/credentials/${cred.number}` : 'stellreducation.org'}</div>
          </div>
        </div>
      </div>
    ),
    size,
  )
}
