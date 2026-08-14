// Shared email chrome (Layer 1). Every campaign — and, over time, the
// transactional templates in lib/email.ts — renders its body inside this single
// wrapper, so the header/footer/branding (and the unsubscribe footer required
// for marketing mail) live in exactly one place.

// House template tokens, taken from the HubSpot reference send.
const PAGE_BG = '#edf1fb'   // pale blue ground behind the white card
const BODY_INK = '#1a1a1a'  // body + footer text
const BODY_FONT = 'Arial, Helvetica, sans-serif'

/** Brand navy — still used by links and call-to-action buttons inside bodies. */
export const BRAND_NAVY = '#1e3a5f'

// Standard sign-off, per the house template. Shared so a title change lands in
// one place rather than in every message body.
const SIGNER = { name: 'David Shaw', title: 'Founder + Chief Inspiration Officer', org: 'Stellr Education' }

export const SIGN_OFF_HTML = `<p style="margin:0">All the best,</p>
      <p style="margin:16px 0 0"><strong>${SIGNER.name}</strong><br/>${SIGNER.title}<br/>${SIGNER.org}</p>`

export const SIGN_OFF_TEXT = ['All the best,', '', SIGNER.name, SIGNER.title, SIGNER.org].join('\n')

// Absolute URL to the Stellr logo (email clients can't load relative/inlined SVG
// reliably, so we point at the hosted PNG on the public site).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
export const EMAIL_LOGO_URL = `${SITE_URL}/stellr-logo.png`

// CAN-SPAM requires a valid physical postal address on marketing email. Shown
// only when an unsubscribe link is present (i.e. marketing, not transactional).
const MARKETING_POSTAL_ADDRESS =
  process.env.MARKETING_POSTAL_ADDRESS ?? '7533 S Center View CT STE R, West Jordan, Utah 84084'

interface LayoutOptions {
  heading: string
  bodyHtml: string
  /** Inbox-preview line; hidden in the body. */
  preheader?: string
  /** When set, renders the CAN-SPAM/CASL unsubscribe footer. Required for marketing. */
  unsubscribeUrl?: string
}

/**
 * Shared chrome for EVERY Stellr email, matching the HubSpot-authored house
 * template (the "Welcome To Stellr Education" send David supplied as the
 * reference): pale blue ground, a single white 600px card, the logo centred on
 * white, and left-aligned Arial body copy at 16px/150%.
 *
 * Table-based on purpose. Outlook's Word rendering engine ignores max-width on a
 * div, so a div-only card renders full-bleed there; the nested tables are what
 * hold the 600px column. Every style is inline for the same reason — Gmail
 * strips <style> blocks from the body.
 */
export function emailLayout({ heading, bodyHtml, preheader, unsubscribeUrl }: LayoutOptions): string {
  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader ?? '')}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0;padding:0;width:100%;background:${PAGE_BG};border-collapse:collapse">
    <tr>
      <td align="center" style="padding:20px 10px;vertical-align:top">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="width:600px;max-width:600px;min-width:280px;background:#ffffff;border-collapse:collapse">
          <tr>
            <td align="center" style="padding:40px 40px 20px">
              <img src="${EMAIL_LOGO_URL}" alt="Stellr Education" width="250" style="width:250px;max-width:100%;display:block;border:0;outline:none" />
            </td>
          </tr>
          <tr>
            <td style="padding:10px 40px 15px;font-family:${BODY_FONT};font-size:22px;line-height:150%;font-weight:bold;color:${BODY_INK}">
              ${escapeHtml(heading)}
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 30px;font-family:${BODY_FONT};font-size:16px;line-height:150%;color:${BODY_INK}">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:10px 20px 30px;font-family:${BODY_FONT};font-size:14px;line-height:135%;color:${BODY_INK}">
              ${escapeHtml(MARKETING_POSTAL_ADDRESS)}${
                unsubscribeUrl
                  ? `<br/><a href="${unsubscribeUrl}" style="color:${BODY_INK};text-decoration:underline">Unsubscribe</a>`
                  : ''
              }
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
