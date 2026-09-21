import { ImageResponse } from 'next/og'
import { supabaseServer } from '@/lib/supabase'
import { tokens } from '@/lib/tokens'
import { credentialState, normaliseCredentialNumber } from '@/lib/credentials-core'
import { badgeAccent, BadgeGlyph } from './glyph'

// GET /credentials/[number]/badge — 600×600 PNG of the badge alone, for a feed
// post image or (later, B-17) a download. Public credentials only; anything
// else gets the generic badge so the URL never confirms a private page.
// Edge for the same bundle-size reason as opengraph-image.tsx.
export const runtime = 'edge'

const SIZE = 600

export async function GET(_req: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  const n = normaliseCredentialNumber(decodeURIComponent(number))

  let theme: Parameters<typeof badgeAccent>[0] = null
  if (n) {
    const { data } = await supabaseServer()
      .from('credentials')
      .select('theme, status, expires_at, tombstoned_at, visibility')
      .eq('number', n)
      .maybeSingle()
    if (data && data.visibility === 'public' && credentialState(data) === 'valid') theme = data.theme
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(180deg, ${tokens.color.midnight}, ${tokens.color.midnightDeep})`,
        }}
      >
        <BadgeGlyph size={SIZE * 0.86} accent={badgeAccent(theme)} />
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    },
  )
}
