import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * A course assigned to an event shows on that event's Space, for the people it
 * is for. And a Resource lesson made of attached resources plays as a list of
 * them, not as "This resource is currently unavailable".
 *
 * WHY (4 Nov 2026): a mentor course assigned to an event reached the mentor's
 * My training page, while the event Space's Training tab said no training was
 * assigned. The tab read only courses linked to the Space itself.
 *
 * The seeded teacher stands in as the mentor because that account can sign in,
 * rostered as a volunteer with the service role, as in mentor-credentials.spec.ts.
 * The Space and course are throwaways, and the roster row comes off in a hook, so
 * a failure part-way leaves nothing behind.
 */

test.use({ storageState: storageStatePath('teacher') })

const EVENT = 'nevada-space-design-challenge'
const TEACHER_ID = '00000000-0000-4000-a000-000000000002' // supabase/seed.sql
const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

function devDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  expect(url, 'these fixtures run only against the dev database').toContain(DEV_PROJECT_REF)
  return createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

test.describe('training on an event Space', () => {
  const suffix = randomUUID().slice(0, 8)
  const spaceSlug = `e2e-space-training-${suffix}`
  const courseTitle = `E2E mentoring ${suffix}`
  let moduleId = ''
  let spaceId = ''
  let cohortId = ''

  const assign = async (audience: 'volunteers' | 'participants') => {
    const db = devDb()
    await db.from('course_object_assignments').delete().eq('module_id', moduleId)
    const { error } = await db.from('course_object_assignments').insert({
      module_id: moduleId,
      object_type: 'competition',
      object_ref: EVENT,
      object_label: 'Nevada',
      default_requirement: 'optional',
      tier_requirements: {},
      audience,
    })
    expect(error, error?.message).toBeNull()
  }

  test.beforeEach(async () => {
    const db = devDb()
    const { data: cohort } = await db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', 'event_participation')
      .is('parent_container_id', null)
      .eq('campaign_ref', EVENT)
      .maybeSingle()
    expect(cohort?.id, `no event container for ${EVENT} on dev`).toBeTruthy()
    cohortId = cohort!.id as string

    const { data: mod, error: modError } = await db
      .from('training_modules')
      .insert({ title: courseTitle, is_published: true })
      .select('id')
      .single()
    expect(modError, modError?.message).toBeNull()
    moduleId = mod!.id as string

    const { data: lessons, error: itemError } = await db
      .from('training_items')
      .insert([
        { module_id: moduleId, title: 'Judging pack', content_kind: 'document', status: 'published', display_order: 0 },
        { module_id: moduleId, title: 'Not ready', content_kind: 'live', status: 'draft', display_order: 1 },
      ])
      .select('id, title')
    expect(itemError, itemError?.message).toBeNull()
    const pack = lessons!.find((l) => l.title === 'Judging pack')!
    const { error: resError } = await db
      .from('training_item_resources')
      .insert({ item_id: pack.id, kind: 'link', title: 'Rover guide', external_url: 'https://example.com/rover' })
    expect(resError, resError?.message).toBeNull()

    const { data: space, error: spaceError } = await db
      .from('community_spaces')
      .insert({ slug: spaceSlug, name: `E2E ${suffix}`, access_type: 'private' })
      .select('id')
      .single()
    expect(spaceError, spaceError?.message).toBeNull()
    spaceId = space!.id as string
    const steps = await Promise.all([
      db.from('community_space_sources').insert({ space_id: spaceId, object_type: 'event', object_ref: EVENT }),
      db.from('community_space_members').insert({ space_id: spaceId, member_id: TEACHER_ID, status: 'active' }),
      db.from('cohort_members').insert({ cohort_id: cohortId, member_id: TEACHER_ID, relationship: 'volunteer', status: 'active' }),
    ])
    for (const { error } of steps) expect(error, error?.message).toBeNull()
  })

  test.afterEach(async () => {
    const db = devDb()
    await db.from('cohort_members').delete().eq('cohort_id', cohortId).eq('member_id', TEACHER_ID).eq('relationship', 'volunteer')
    if (moduleId) {
      await db.from('training_enrollments').delete().eq('module_id', moduleId)
      await db.from('training_modules').delete().eq('id', moduleId)
    }
    if (spaceId) await db.from('community_spaces').delete().eq('id', spaceId)
  })

  test('shows the event course to a volunteer, counting published lessons only', async ({ page }) => {
    await assign('volunteers')
    await page.goto(`/community/${spaceSlug}/training`)
    await expect(page.getByRole('heading', { name: courseTitle })).toBeVisible()
    await expect(page.getByText('0/1 lessons')).toBeVisible()
    await expect(page.getByText('Assigned for Nevada')).toBeVisible()
  })

  test('leaves it out for someone the course is not for', async ({ page }) => {
    await assign('participants')
    await page.goto(`/community/${spaceSlug}/training`)
    await expect(page.getByText('No training assigned to you in this space.')).toBeVisible()
    await expect(page.getByRole('heading', { name: courseTitle })).toHaveCount(0)
  })

  test('a Resource lesson with only attached resources lists them', async ({ page }) => {
    await assign('volunteers')
    await page.goto(`/community/training/${moduleId}`)
    await expect(page.getByRole('link', { name: 'Rover guide' })).toBeVisible()
    await expect(page.getByText('This resource is currently unavailable')).toHaveCount(0)
    await expect(page.getByText('No media for this lesson yet')).toHaveCount(0)
  })
})
