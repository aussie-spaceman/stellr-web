import { escapeHtml } from '@/lib/email-layout'

// Email sent to someone who asked for a gated download (lib/gated-assets.ts).
// The link is signed (lib/gated-download-link.ts) and does not expire.

export function gatedAssetEmailHtml(firstName: string, title: string, downloadUrl: string) {
  // deep review PUB-2: sent from the marketing sender to the submitted address,
  // so escape the submitted name and every other interpolated value to stop
  // injected markup rendering. The plain-text copy below is unaffected.
  const greeting = escapeHtml(firstName || 'there')
  const safeTitle = escapeHtml(title)
  const href = escapeHtml(downloadUrl)
  return `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#F6F7FB;padding:32px 16px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E4E7F2;border-radius:16px;overflow:hidden">
      <div style="background:#0E1330;padding:28px 32px">
        <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:#fff;font-size:18px;letter-spacing:-.01em">Stellr Education</div>
      </div>
      <div style="padding:32px">
        <p style="color:#13183A;font-size:16px;margin:0 0 12px">Hi ${greeting},</p>
        <p style="color:#454B68;font-size:15px;line-height:1.6;margin:0 0 18px">
          Thanks for your interest — your copy of <strong>${safeTitle}</strong> is ready. Download it using the
          button below.
        </p>
        <p style="margin:24px 0">
          <a href="${href}" style="display:inline-block;background:#3C6DF6;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">Download now</a>
        </p>
        <p style="color:#6A708C;font-size:13px;line-height:1.6;margin:18px 0 0">
          You'll get the occasional update from the Stellr community — you can unsubscribe any time.
        </p>
      </div>
    </div>
  </div>`
}

export function gatedAssetEmailText(firstName: string, title: string, downloadUrl: string) {
  return [
    `Hi ${firstName || 'there'},`,
    '',
    `Thanks for your interest — your copy of ${title} is ready. Download it here:`,
    downloadUrl,
    '',
    "You'll get the occasional update from the Stellr community — you can unsubscribe any time.",
    '',
    '— Stellr Education',
  ].join('\n')
}
