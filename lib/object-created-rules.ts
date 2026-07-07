import { supabaseServer } from '@/lib/supabase'
import {
  attachAllowed,
  OBJECT_TO_SPACE_SOURCE_TYPE,
  type AccessObjectType,
} from '@/lib/access-objects'

// The object_created trigger runtime (admin/access convergence). When a new
// object comes into existence — from the New Object wizard or the Sanity
// event-sync webhook — every active tier_grant_rules row with
// trigger_type='object_created' matching the new object's type fires:
//   attach_object → the grant object is attached to the new object
//                   (container_contents for courses/resources, community_
//                   space_sources for Spaces)
//   roster_add    → handled at member-registration time, not here (those rules
//                   match members joining the object, e.g. r14/r16 in the seed)
//   tier          → likewise member-scoped; ignored at creation time
// Tier/roster grants for members flow through lib/membership-grants.ts /
// lib/auto-membership-grant.ts as before — this module only performs the
// object→object effects.

export interface ObjectCreatedResult {
  applied: { ruleId: string; ruleName: string; action: string }[]
  skipped: { ruleId: string; ruleName: string; reason: string }[]
}

export async function fireObjectCreatedRules(newObject: {
  objectType: AccessObjectType
  /** Container uuid, or event/campaign slug. */
  ref: string
  /** Container id when the object is container-backed (contents attach here). */
  containerId?: string
}): Promise<ObjectCreatedResult> {
  const db = supabaseServer()
  const result: ObjectCreatedResult = { applied: [], skipped: [] }

  const { data: rules } = await db
    .from('tier_grant_rules')
    .select('id, name, grant_kind, grant_object_type, grant_object_ref, is_dynamic')
    .eq('trigger_type', 'object_created')
    .eq('object_type', newObject.objectType)
    .eq('is_active', true)
    .order('priority', { ascending: false })

  for (const rule of rules ?? []) {
    if (rule.grant_kind !== 'attach_object') continue // member-scoped kinds fire elsewhere
    if (!rule.grant_object_ref) {
      if (rule.is_dynamic) continue // wizard supplies the target interactively
      result.skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'no grant_object_ref' })
      continue
    }

    const toType = rule.grant_object_type as AccessObjectType
    if (!(await attachAllowed(newObject.objectType, toType))) {
      result.skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'relationship matrix denies' })
      continue
    }

    if (toType === 'space') {
      const sourceType = OBJECT_TO_SPACE_SOURCE_TYPE[newObject.objectType]
      if (!sourceType) {
        result.skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'object type has no space link' })
        continue
      }
      const { error } = await db.from('community_space_sources').upsert(
        { space_id: rule.grant_object_ref, object_type: sourceType, object_ref: newObject.ref },
        { onConflict: 'space_id,object_type,object_ref', ignoreDuplicates: true },
      )
      if (error) {
        result.skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: error.message })
        continue
      }
      result.applied.push({ ruleId: rule.id, ruleName: rule.name, action: `attached space ${rule.grant_object_ref}` })
      continue
    }

    if (!newObject.containerId) {
      result.skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: 'object has no content container' })
      continue
    }
    const contentType = toType === 'course' ? 'training_module' : 'resource'
    const { error } = await db.from('container_contents').upsert(
      {
        container_id: newObject.containerId,
        content_type: contentType,
        content_ref: rule.grant_object_ref,
        is_mandatory: false,
      },
      { onConflict: 'container_id,content_type,content_ref', ignoreDuplicates: true },
    )
    if (error) {
      result.skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: error.message })
      continue
    }
    result.applied.push({ ruleId: rule.id, ruleName: rule.name, action: `attached ${contentType} ${rule.grant_object_ref}` })
  }

  return result
}
