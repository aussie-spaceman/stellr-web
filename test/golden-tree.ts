import { isValidElement, type ReactElement } from 'react'

// The element tree a page returns, as plain data: what Next serialises for both the
// HTML and the page payload. For tests that pin a page before it is split.

function typeName(type: unknown): string {
  if (typeof type === 'string') return type
  if (typeof type === 'function') return type.name || 'anonymous'
  if (typeof type === 'symbol') return String(type)
  const obj = type as { displayName?: string; render?: { name?: string }; $$typeof?: symbol }
  return obj.displayName ?? obj.render?.name ?? String(obj.$$typeof)
}

/** The element tree as plain data, with false, null and undefined kept apart. */
export function tree(node: unknown): unknown {
  if (node === undefined) return '$undefined'
  if (typeof node === 'function') return `$fn ${node.name}`
  if (Array.isArray(node)) return node.map(tree)
  if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>
    const props = Object.fromEntries(Object.entries(el.props).map(([k, v]) => [k, tree(v)]))
    return { type: typeName(el.type), ...(el.key ? { key: el.key } : {}), props }
  }
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, tree(v)]))
  return node
}
