// deep review QUAL-6: supabase-js never throws on a failed query — it resolves
// `{ data: null, error }`. Code written `const { data } = await q` turns an
// outage (a PostgREST 5xx, a statement timeout, pool exhaustion during a cron
// fan-out) into an empty result. Where an empty list means "deny" that fails
// closed; where it means "nobody opted out / nothing to do / not registered
// yet" it fails OPEN or silently skips work — a cron reports `sent: 0` and
// `cron_runs` looks healthy, an export returns a short file, a consent check
// reads "no opt-out".
//
// These helpers make a decision-making read fail LOUD: an error throws with a
// human label instead of being read as "no rows", so the caller (a cron, a
// money path, a safeguarding teardown) fails and can be retried rather than
// quietly doing the wrong thing. Use them for reads whose emptiness is a
// decision; a read whose empty result genuinely means "deny" is already safe.

export interface QueryResult<T> {
  data: T | null
  error: { message: string } | null
}

/** Awaits a multi-row query and returns its rows, throwing on any error. */
export async function rows<T>(q: PromiseLike<QueryResult<T[]>>, what: string): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new Error(`${what}: ${error.message}`)
  return data ?? []
}

/** Awaits a single-row query and returns the row or null, throwing on any error. */
export async function one<T>(q: PromiseLike<QueryResult<T>>, what: string): Promise<T | null> {
  const { data, error } = await q
  if (error) throw new Error(`${what}: ${error.message}`)
  return data ?? null
}
