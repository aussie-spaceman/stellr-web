// Rendering pipeline for DB-backed campaign templates:
//   Tiptap JSON  ──tiptapToEmailHtml──▶  inline-styled body HTML
//   subject/body ──substituteTokens──▶   merge fields filled in
//   wrap body    ──emailLayout──────▶    final email (chrome + unsubscribe)
//
// No @tiptap/html dependency — we walk the doc and emit email-safe inline styles
// directly, mirroring the hand-styled look of lib/email.ts.

import { tiptapToPlainText } from '@/lib/community'
import { emailLayout, escapeHtml } from '@/lib/email-layout'

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/**
 * Replace {{tokens}} from `vars`. Throws on an unknown token so a campaign never
 * goes out with a literal "{{firstName}}" in it — callers should surface this as
 * a validation error before scheduling.
 */
export function substituteTokens(input: string, vars: Record<string, string>): string {
  return input.replace(TOKEN, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Unknown merge field {{${key}}}`)
    return vars[key]
  })
}

/** Names of every {{token}} referenced in a string (for pre-send validation). */
export function extractTokens(input: string): string[] {
  return [...input.matchAll(TOKEN)].map((m) => m[1])
}

type Node = { type?: string; text?: string; marks?: Mark[]; content?: Node[]; attrs?: Record<string, unknown> }
type Mark = { type: string; attrs?: Record<string, unknown> }

function renderMarks(text: string, marks?: Mark[]): string {
  let out = escapeHtml(text)
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold': out = `<strong>${out}</strong>`; break
      case 'italic': out = `<em>${out}</em>`; break
      case 'underline': out = `<u>${out}</u>`; break
      case 'strike': out = `<s>${out}</s>`; break
      case 'code': out = `<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px">${out}</code>`; break
      case 'link': {
        const href = String(mark.attrs?.href ?? '#')
        out = `<a href="${escapeHtml(href)}" style="color:#1e3a5f;text-decoration:underline">${out}</a>`
        break
      }
    }
  }
  return out
}

function renderNode(node: Node): string {
  if (node.type === 'text') return renderMarks(node.text ?? '', node.marks)

  const children = (node.content ?? []).map(renderNode).join('')

  switch (node.type) {
    case 'doc': return children
    case 'paragraph':
      return `<p style="margin:0 0 16px">${children || '&nbsp;'}</p>`
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 3)
      const size = { 1: '22px', 2: '18px', 3: '16px' }[level as 1 | 2 | 3]
      return `<h${level} style="margin:24px 0 12px;font-size:${size};color:#111827">${children}</h${level}>`
    }
    case 'bulletList':
      return `<ul style="margin:0 0 16px;padding-left:24px">${children}</ul>`
    case 'orderedList':
      return `<ol style="margin:0 0 16px;padding-left:24px">${children}</ol>`
    case 'listItem':
      return `<li style="margin:0 0 6px">${children}</li>`
    case 'blockquote':
      return `<blockquote style="margin:0 0 16px;padding-left:16px;border-left:3px solid #d1d5db;color:#6b7280">${children}</blockquote>`
    case 'codeBlock':
      return `<pre style="margin:0 0 16px;padding:12px;background:#f3f4f6;border-radius:6px;overflow:auto"><code>${children}</code></pre>`
    case 'horizontalRule':
      return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>`
    case 'hardBreak':
      return '<br/>'
    default:
      return children
  }
}

/** Render a Tiptap doc to email-safe inline-styled HTML. */
export function tiptapToEmailHtml(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  return renderNode(doc as Node)
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/**
 * Render a stored template for one recipient: substitute tokens in the subject
 * and body, convert the body to HTML, and wrap it in the shared chrome with the
 * recipient's unsubscribe link.
 */
export function renderCampaignEmail(
  template: { name: string; subject: string; body_json: unknown },
  vars: Record<string, string>,
  unsubscribeUrl: string,
): RenderedEmail {
  const subject = substituteTokens(template.subject, vars)
  const bodyHtml = substituteTokens(tiptapToEmailHtml(template.body_json), vars)
  const text = substituteTokens(tiptapToPlainText(template.body_json), vars)
  const html = emailLayout({ heading: subject, bodyHtml, preheader: text.slice(0, 120), unsubscribeUrl })
  return { subject, html, text }
}
