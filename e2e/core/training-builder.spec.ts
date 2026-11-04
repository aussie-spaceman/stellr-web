import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * The Course builder: lesson order, resources on a new lesson, and a recording's
 * status and deletion.
 *
 * WHY (4 Nov 2026): a recording that failed to save left the lesson reading
 * "No recording yet", as though the session had never happened, and the video was
 * gone 24 hours later. These read the status the way an admin does.
 *
 * Builds its own throwaway course, so it touches no shared fixture.
 */

test.use({ storageState: storageStatePath('admin') })


// This writes and deletes rows and storage objects directly.
function fixtureDb() {
  const url = assertE2eSupabase()
  const key = supabaseSecretKey()
  if (!key) throw new Error('training-builder.spec needs the Supabase secret key')
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

const ITEMS = '/api/admin/community/training/items'
const SECTIONS = '/api/admin/community/training/sections'
const MODULES = '/api/admin/community/training/modules'

test.describe('course builder', () => {
  let moduleId = ''
  let sectionA = ''
  let sectionB = ''
  const lessons: Record<string, string> = {}

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin') // Clerk refreshes a saved session on navigation, not on a bare request.
    const suffix = randomUUID().slice(0, 8)
    const created = await page.request.post(MODULES, { data: { title: `E2E builder ${suffix}` } })
    expect(created.ok(), `creating the course: ${created.status()} ${await created.text()}`).toBe(true)
    moduleId = (await created.json()).id
    const section = async (title: string, displayOrder: number) => {
      await page.request.post(SECTIONS, { data: { moduleId, title, displayOrder } })
    }
    await section('Alpha', 0)
    await section('Beta', 1)
    const db = fixtureDb()
    const { data: rows } = await db.from('training_sections').select('id, title').eq('module_id', moduleId)
    sectionA = rows!.find((r) => r.title === 'Alpha')!.id
    sectionB = rows!.find((r) => r.title === 'Beta')!.id
    const lesson = async (title: string, sectionId: string, displayOrder: number) => {
      const res = await page.request.post(ITEMS, {
        data: { moduleId, sectionId, title, contentKind: 'live', status: 'published', displayOrder: String(displayOrder) },
      })
      lessons[title] = (await res.json()).id
    }
    await lesson('One', sectionA, 0)
    await lesson('Two', sectionA, 1)
    await lesson('Three', sectionB, 0)
    await page.goto(`/admin/academy/training?tab=builder&course=${moduleId}`)
    await expect(page.getByRole('button', { name: /^One/ })).toBeVisible()
  })

  test.afterEach(async () => {
    const db = fixtureDb()
    await db.from('recording_offloads').delete().in('target_id', Object.values(lessons))
    await db.from('training_modules').delete().eq('id', moduleId)
  })

  const placement = async () => {
    const { data } = await fixtureDb()
      .from('training_items')
      .select('title, section_id, display_order')
      .eq('module_id', moduleId)
      .order('display_order')
    const inSection = (id: string) => data!.filter((r) => r.section_id === id).map((r) => r.title)
    return { a: inSection(sectionA), b: inSection(sectionB) }
  }
  const row = (page: import('@playwright/test').Page, title: string) =>
    page.locator('[draggable="true"]').filter({ has: page.getByRole('button', { name: new RegExp(`^${title}`) }) })

  test('drags a lesson within a section', async ({ page }) => {
    await row(page, 'Two').dragTo(row(page, 'One'), { targetPosition: { x: 40, y: 2 } })
    await expect.poll(placement).toEqual({ a: ['Two', 'One'], b: ['Three'] })
  })

  test('drags a lesson into another section', async ({ page }) => {
    await row(page, 'One').dragTo(row(page, 'Three'), { targetPosition: { x: 40, y: 2 } })
    await expect.poll(placement).toEqual({ a: ['Two'], b: ['One', 'Three'] })
    await page.reload()
    await expect(row(page, 'One')).toBeVisible()
  })

  test('moves a lesson across sections with the arrow buttons alone', async ({ page }) => {
    await page.getByRole('button', { name: 'Move Two down' }).click()
    await expect.poll(placement).toEqual({ a: ['One'], b: ['Two', 'Three'] })
    // Focus stays with the control, for a keyboard user moving it again.
    await expect(page.getByRole('button', { name: 'Move Two down' })).toBeFocused()
  })

  test('attaches a resource picked while creating a lesson', async ({ page }) => {
    await page.getByRole('button', { name: 'Add lesson' }).first().click()
    await page.getByPlaceholder('Lesson title').fill('Four')
    await page.getByRole('button', { name: 'Add resource' }).click()
    await page.getByPlaceholder('Title', { exact: true }).fill('Rover guide')
    await page.getByPlaceholder('https://…').first().fill('https://example.com/rover')
    await page.getByRole('button', { name: 'Add resource' }).click()
    await expect(page.getByText('These attach when you add the lesson.')).toBeVisible()

    await page.getByRole('button', { name: 'Add lesson', exact: true }).last().click()

    await expect(row(page, 'Four')).toBeVisible()
    const db = fixtureDb()
    const { data: item } = await db.from('training_items').select('id').eq('module_id', moduleId).eq('title', 'Four').single()
    lessons.Four = item!.id
    const { data: resources } = await db.from('training_item_resources').select('title, kind, external_url').eq('item_id', item!.id)
    expect(resources).toEqual([{ title: 'Rover guide', kind: 'link', external_url: 'https://example.com/rover' }])
  })

  test('a failed recording says why, and can be dismissed', async ({ page }) => {
    await fixtureDb().from('recording_offloads').upsert({
      target_kind: 'training',
      target_id: lessons.One,
      status: 'failed',
      error: 'This recording is 212 MB, which is over the storage limit per file.',
      source_url: 'https://example.com/never-fetched.mp4',
      source_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    })
    await page.reload()
    await expect(row(page, 'One').getByText('Not saved')).toBeVisible()
    await page.getByRole('button', { name: /^One/ }).click()
    await expect(page.getByText(/212 MB, which is over the storage limit/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('No recording yet.')).toBeVisible()
  })

  test('shows a recording on its way, and that it is safe to leave', async ({ page }) => {
    await fixtureDb().from('recording_offloads').upsert({ target_kind: 'training', target_id: lessons.One, status: 'saving' })
    await page.reload()
    await expect(row(page, 'One').getByText('Saving')).toBeVisible()
    await page.getByRole('button', { name: /^One/ }).click()
    await expect(page.getByText(/Saving the recording to this lesson\. It is safe to leave/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Launch recording session' })).toBeDisabled()
  })

  test('deletes a saved recording, file included', async ({ page }) => {
    const db = fixtureDb()
    const path = `recordings/train-${lessons.One}.mp4`
    await db.storage.from('community-resources').upload(path, new Blob(['not really a video'], { type: 'video/mp4' }), { upsert: true })
    await db.from('training_items').update({ recording_status: 'available', recording_path: path }).eq('id', lessons.One)

    await page.reload()
    await page.getByRole('button', { name: /^One/ }).click()
    await expect(page.getByText('Recording saved to this lesson.')).toBeVisible()
    await page.getByRole('button', { name: 'Delete recording' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete recording' }).click()
    await expect(page.getByText('No recording yet.')).toBeVisible()

    const { data: item } = await db.from('training_items').select('recording_status, recording_path').eq('id', lessons.One).single()
    expect(item).toEqual({ recording_status: 'none', recording_path: null })
    const { data: files } = await db.storage.from('community-resources').list('recordings', { search: `train-${lessons.One}` })
    expect(files).toEqual([])
  })
})
