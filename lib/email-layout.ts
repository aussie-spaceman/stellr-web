// Shared email chrome (Layer 1). Every campaign — and, over time, the
// transactional templates in lib/email.ts — renders its body inside this single
// wrapper, so the header/footer/branding (and the unsubscribe footer required
// for marketing mail) live in exactly one place.

const BRAND_NAVY = '#1e3a5f'
const FOOTER_BG = '#f3f4f6'

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

export function emailLayout({ heading, bodyHtml, preheader, unsubscribeUrl }: LayoutOptions): string {
  return `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader ?? '')}</div>
  <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
    <div style="background:${BRAND_NAVY};padding:24px 32px;color:#ffffff">
      <img src="${EMAIL_LOGO_URL}" alt="Stellr Education" height="32" style="display:block;height:32px;width:auto;margin-bottom:12px;border:0" />
      <div style="font-size:18px;font-weight:600">${escapeHtml(heading)}</div>
    </div>
    <div style="padding:32px;color:#374151;font-size:15px;line-height:1.6">
      ${bodyHtml}
    </div>
    <div style="background:${FOOTER_BG};padding:16px 32px;text-align:center;color:#6b7280;font-size:12px;line-height:1.5">
      © ${new Date().getFullYear()} Stellr Education. All rights reserved.${unsubscribeUrl ? `<br/>${escapeHtml(MARKETING_POSTAL_ADDRESS)}<br/><a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe from these emails</a>` : ''}
    </div>
  </div>`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
