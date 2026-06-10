// Reusable email content blocks (Layer 2). Shared by transactional templates
// and campaign rendering so a button/callout looks identical everywhere and is
// styled in one place. All inline-styled for email-client compatibility.

const BRAND_NAVY = '#1e3a5f'

export function button(url: string, label: string): string {
  return `<div style="margin:28px 0;text-align:center">
    <a href="${url}" style="display:inline-block;background:${BRAND_NAVY};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600">${label}</a>
  </div>`
}

type CalloutVariant = 'info' | 'success' | 'warning'

const CALLOUT_COLORS: Record<CalloutVariant, [string, string]> = {
  info: ['#eff6ff', '#bfdbfe'],
  success: ['#f0fdf4', '#bbf7d0'],
  warning: ['#fffbeb', '#fde68a'],
}

export function callout(html: string, variant: CalloutVariant = 'info'): string {
  const [bg, border] = CALLOUT_COLORS[variant]
  return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:16px;margin:24px 0">${html}</div>`
}
