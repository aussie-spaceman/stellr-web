// Validate that every {{token}} an author typed is one the engine can resolve,
// so a bad merge field is caught at save/schedule time, not mid-blast.

import { MERGE_FIELDS } from '@/lib/email-vars'
import { extractTokens } from '@/lib/email-render'

const KNOWN = new Set([...MERGE_FIELDS.map((f) => f.token), 'unsubscribeUrl'])

/** Returns the list of unknown tokens found across the given strings ([] = all valid). */
export function unknownTokens(...strings: string[]): string[] {
  const found = strings.flatMap(extractTokens)
  return [...new Set(found.filter((t) => !KNOWN.has(t)))]
}
