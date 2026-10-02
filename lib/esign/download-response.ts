import { NextResponse } from 'next/server'
import type { SignedRecord } from '@/lib/esign/archive'

/**
 * The HTTP answer for a signed-record download.
 *
 * A stored record comes back as JSON carrying a short-lived link the browser
 * follows: the PDF never passes through a function, so Vercel's 4.5 MB
 * response limit does not apply. Only the live-fetch fallback streams bytes.
 * Nothing here may be cached by the browser or a proxy.
 */
export function signedRecordResponse(record: SignedRecord): NextResponse {
  const noStore = { 'Cache-Control': 'private, no-store' }
  switch (record.kind) {
    case 'url':
      return NextResponse.json({ url: record.url, filename: record.filename }, { headers: noStore })
    case 'bytes':
      return new NextResponse(record.bytes, {
        headers: {
          ...noStore,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${record.filename}"`,
        },
      })
    case 'unavailable':
      return NextResponse.json({ error: record.reason }, { status: 409, headers: noStore })
  }
}
