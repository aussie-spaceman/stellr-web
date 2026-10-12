import { Fragment } from 'react'

// Server-side renderer for stored TipTap JSON (the StarterKit node/mark set).
// Read-only views use this instead of mounting the editor, so comment-heavy
// pages stay light. Unknown node types fall back to rendering their children.

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  attrs?: Record<string, unknown>
}

// deep review MEM-17: stored body_json is authored client-side, so a link mark or
// image node can carry any href/src. React already neutralises `javascript:`
// hrefs, so this is not XSS — the residual risks are (a) non-web link schemes
// (`data:`, `tel:` spoofs, protocol-relative off-site links) and (b) an external
// image src acting as a tracking pixel that logs the IP/UA of every member,
// minors included, who opens the post. Restrict both at render time.

/** An href safe to render as a link, or null to render the text un-linked. */
function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const href = raw.trim()
  if (!href || href === '#') return null
  // Protocol-relative (`//host`) and backslash variants resolve off-site — drop.
  if (href.startsWith('//') || href.startsWith('\\')) return null
  // Same-origin relative links (incl. in-page anchors) are safe as-is.
  if (href.startsWith('/') || href.startsWith('#')) return href
  try {
    const scheme = new URL(href).protocol
    return scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:' ? href : null
  } catch {
    // Not a parseable absolute URL and not a recognised relative form — drop.
    return null
  }
}

// Embedded images must come through the access-gated media proxy (a relative
// path, so it cannot point off-site). Anything else — including an absolute URL
// to our own path on another host — is dropped.
const MEDIA_PREFIX = '/api/community/media/community-media/'

/** An image src safe to render, or null to drop the image. */
function safeImageSrc(raw: unknown): string | null {
  return typeof raw === 'string' && raw.startsWith(MEDIA_PREFIX) ? raw : null
}

function renderMarks(text: string, marks: TipTapNode['marks'], key: number): React.ReactNode {
  if (!marks || marks.length === 0) return <Fragment key={key}>{text}</Fragment>
  return marks.reduce<React.ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{acc}</strong>
      case 'italic':
        return <em>{acc}</em>
      case 'code':
        return <code className="rounded bg-brand-hairline px-1 py-0.5 text-sm">{acc}</code>
      case 'strike':
        return <s>{acc}</s>
      case 'link': {
        // deep review MEM-17: only link out to web/mail/same-origin targets.
        // An unsafe scheme renders as plain text (the mark is simply dropped).
        const href = safeHref(mark.attrs?.href)
        if (!href) return acc
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-blue underline">
            {acc}
          </a>
        )
      }
      default:
        return acc
    }
  }, <Fragment key={key}>{text}</Fragment>)
}

function renderNode(node: TipTapNode, key: number): React.ReactNode {
  if (node.type === 'text') {
    return renderMarks(node.text ?? '', node.marks, key)
  }

  const children = (node.content ?? []).map((child, i) => renderNode(child, i))

  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children}</p>
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2
      const Tag = (`h${Math.min(Math.max(level, 1), 6)}`) as keyof React.JSX.IntrinsicElements
      return <Tag key={key}>{children}</Tag>
    }
    case 'bulletList':
      return <ul key={key}>{children}</ul>
    case 'orderedList':
      return <ol key={key}>{children}</ol>
    case 'listItem':
      return <li key={key}>{children}</li>
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'codeBlock':
      return (
        <pre key={key} className="overflow-x-auto rounded bg-brand-hairline p-3 text-sm">
          <code>{children}</code>
        </pre>
      )
    case 'hardBreak':
      return <br key={key} />
    case 'horizontalRule':
      return <hr key={key} />
    case 'mention': {
      const label =
        typeof node.attrs?.label === 'string'
          ? node.attrs.label
          : typeof node.attrs?.id === 'string'
            ? node.attrs.id
            : 'member'
      return (
        <span key={key} className="rounded bg-brand-blue/10 px-1 font-medium text-brand-blue">
          @{label}
        </span>
      )
    }
    case 'image': {
      // deep review MEM-17: drop any image that isn't served by the access-gated
      // media proxy, so a post can't embed an external tracking pixel.
      const src = safeImageSrc(node.attrs?.src)
      if (!src) return <Fragment key={key} />
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      // eslint-disable-next-line @next/next/no-img-element -- served by the access-gated /api/community/media proxy, which the optimizer cannot call with the viewer's cookies
      return <img key={key} src={src} alt={alt} loading="lazy" className="my-2 max-h-80 rounded-lg" />
    }
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

export function RichTextContent({ doc }: { doc: unknown }) {
  if (!doc || typeof doc !== 'object') return null
  const root = doc as TipTapNode
  const content = root.content ?? []
  return (
    <div className="prose prose-sm max-w-none">
      {content.map((node, i) => renderNode(node, i))}
    </div>
  )
}
