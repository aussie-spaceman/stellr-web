import { supabaseServer } from '@/lib/supabase'
import { getEntityDef } from './registry'
import type { Blocker, PreflightResult } from './types'

// Runs a count query per declared dependent and returns the non-empty ones as
// blockers. This is the single source of the "what must be deleted first"
// message shown to admins and used to guard executeDeletion().
export async function deletionPreflight(entity: string, id: string): Promise<PreflightResult> {
  const def = getEntityDef(entity)
  if (!def) throw new Error(`Unknown deletable entity type: ${entity}`)

  const db = supabaseServer()

  const blockers: Blocker[] = await Promise.all(
    def.dependents.map(async (dep) => {
      let query = db
        .from(dep.table)
        .select('*', { count: 'exact', head: true })
        .eq(dep.fkColumn, id)

      if (dep.activeFilter) {
        query = query.eq(dep.activeFilter.column, dep.activeFilter.value as never)
      }

      const { count, error } = await query
      if (error) {
        // A missing column/table is a registry bug — surface loudly rather than
        // silently letting a delete through.
        throw new Error(`Preflight count failed for ${dep.table}.${dep.fkColumn}: ${error.message}`)
      }

      return {
        table: dep.table,
        label: dep.label,
        count: count ?? 0,
        adminHref: dep.adminHref?.replace('{id}', id),
      }
    })
  ).then((rows) => rows.filter((r) => r.count > 0))

  return {
    entity,
    id,
    blockers,
    canDelete: blockers.length === 0,
  }
}
