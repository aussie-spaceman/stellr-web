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
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#'
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
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : null
      if (!src) return <Fragment key={key} />
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      // eslint-disable-next-line @next/next/no-img-element
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
