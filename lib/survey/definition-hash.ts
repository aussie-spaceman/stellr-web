/**
 * Content hash of a survey definition (survey_definitions.definition_sha256).
 * Server-only: kept apart from definition.ts so the renderer can import that
 * in the browser.
 */
import { createHash } from 'node:crypto'

/** Stable JSON (sorted keys) so the same definition always hashes the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function definitionSha256(raw: unknown): string {
  return createHash('sha256').update(stableStringify(raw)).digest('hex')
}
