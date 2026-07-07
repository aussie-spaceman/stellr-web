import { supabaseServer } from '@/lib/supabase'

// Admin central resource index (handover §4.6). ONE row per stored binary +
// what it's attached to. Volume and dedup are surfaced here because the admin
// requirement is managing total stored file volume — the dedup payoff.

export interface AdminBinaryRow {
  id: string
  title: string
  fileType: string | null
  isLink: boolean
  sizeBytes: number | null
  uploaderName: string | null
  createdAt: string
  /** How many container_contents rows reference this binary. */
  attachedCount: number
  /** Names of the objects it's attached to (for the delete-cascade confirm). */
  attachedObjects: string[]
  /** Pending resource flags against this binary. */
  pendingFlags: number
  /** Aggregate opens/downloads across all attachments. */
  downloads: number
  /**
   * 'community' = a community_resources binary (rename/delete inline).
   * 'training'  = a lesson recording / lesson resource, which lives in the
   * separate training content model (training_items / training_item_resources),
   * NOT community_resources. Surfaced here read-only so recordings are visible
   * centrally (they otherwise only show in the course builder and the member
   * catalogue); managed from the course builder via `builderHref`.
   */
  source: 'community' | 'training'
  /** Deep link to the course builder for training rows; null for community rows. */
  builderHref: string | null
}

export interface AdminResourceStats {
  binaryCount: number
  totalBytes: number
  /** Attach-by-reference reuses = attachments beyond the first per binary. */
  duplicatesPrevented: number
  openFlags: number
}

export async function getAdminResourceIndex(): Promise<{ rows: AdminBinaryRow[]; stats: AdminResourceStats }> {
  const db = supabaseServer()

  const [{ data: binaries }, { data: attachments }, { data: flags }] = await Promise.all([
    db
      .from('community_resources')
      .select('id, title, file_type, file_size_bytes, created_at, uploaded_by, download_count')
      .order('created_at', { ascending: false }),
    db
      .from('container_contents')
      .select('content_ref, container_id')
      .in('content_type', ['resource', 'recording']),
    db.from('community_flags').select('content_id').eq('content_type', 'resource').eq('status', 'pending'),
  ])

  const bins = (binaries ?? []) as {
    id: string
    title: string
    file_type: string | null
    file_size_bytes: number | null
    created_at: string
    uploaded_by: string | null
    download_count: number | null
  }[]

  // Resolve container names + uploader names.
  const containerIds = [...new Set((attachments ?? []).map((a) => a.container_id as string))]
  const uploaderIds = [...new Set(bins.map((b) => b.uploaded_by).filter((x): x is string => !!x))]
  const [{ data: containers }, { data: members }] = await Promise.all([
    containerIds.length
      ? db.from('mentoring_cohorts').select('id, name').in('id', containerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    uploaderIds.length
      ? db.from('members').select('id, first_name, last_name').in('id', uploaderIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
  ])
  const containerName = new Map((containers ?? []).map((c) => [c.id as string, (c.name as string).split(' — ')[0]]))
  const uploaderName = new Map(
    (members ?? []).map((m) => [m.id as string, [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || 'Unknown']),
  )

  // Group attachments by binary.
  const attachedNames = new Map<string, string[]>()
  for (const a of attachments ?? []) {
    const ref = a.content_ref as string
    const name = containerName.get(a.container_id as string) ?? 'Unknown object'
    attachedNames.set(ref, [...(attachedNames.get(ref) ?? []), name])
  }

  const flagCount = new Map<string, number>()
  for (const f of flags ?? []) {
    const id = f.content_id as string
    flagCount.set(id, (flagCount.get(id) ?? 0) + 1)
  }

  const communityRows: AdminBinaryRow[] = bins.map((b) => {
    const objs = attachedNames.get(b.id) ?? []
    return {
      id: b.id,
      title: b.title,
      fileType: b.file_type,
      isLink: (b.file_type ?? '').toLowerCase() === 'link',
      sizeBytes: b.file_size_bytes,
      uploaderName: b.uploaded_by ? uploaderName.get(b.uploaded_by) ?? null : null,
      createdAt: b.created_at,
      attachedCount: objs.length,
      attachedObjects: objs,
      pendingFlags: flagCount.get(b.id) ?? 0,
      downloads: b.download_count ?? 0,
      source: 'community',
      builderHref: null,
    }
  })

  // Training content (lesson recordings + lesson resources) lives outside
  // community_resources, so it's fetched separately and merged read-only.
  const trainingRows = await getTrainingResourceRows()
  const rows = [...communityRows, ...trainingRows].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  )

  const totalAttachments = (attachments ?? []).length
  const distinctAttached = attachedNames.size
  const stats: AdminResourceStats = {
    binaryCount: bins.length,
    totalBytes: bins.reduce((sum, b) => sum + (b.file_size_bytes ?? 0), 0),
    duplicatesPrevented: Math.max(0, totalAttachments - distinctAttached),
    openFlags: (flags ?? []).length,
  }

  return { rows, stats }
}

/**
 * Read-only admin rows for training content that isn't a community_resources
 * binary: lesson recordings (training_items.recording_path) and lesson resources
 * (training_item_resources). These surface in the member catalogue but, being a
 * separate content model, were invisible on the central admin index — so JaaS
 * recordings appeared everywhere EXCEPT here. They're managed from the course
 * builder (builderHref), not renamed/deleted inline.
 */
async function getTrainingResourceRows(): Promise<AdminBinaryRow[]> {
  const db = supabaseServer()

  const [{ data: recItems }, { data: res }] = await Promise.all([
    db
      .from('training_items')
      .select('id, module_id, title, created_at')
      .eq('recording_status', 'available')
      .not('recording_path', 'is', null),
    db.from('training_item_resources').select('id, item_id, kind, title, created_at'),
  ])

  // Resolve the module + lesson title behind every row for the "Attached to" cell.
  const resItemIds = [...new Set((res ?? []).map((r) => r.item_id as string))]
  const { data: resItems } = resItemIds.length
    ? await db.from('training_items').select('id, module_id, title').in('id', resItemIds)
    : { data: [] as { id: string; module_id: string; title: string }[] }
  const lessonById = new Map<string, { moduleId: string; title: string }>()
  for (const i of [...(recItems ?? []), ...(resItems ?? [])]) {
    lessonById.set(i.id as string, { moduleId: i.module_id as string, title: i.title as string })
  }

  const moduleIds = [...new Set([...lessonById.values()].map((l) => l.moduleId))]
  const { data: modules } = moduleIds.length
    ? await db.from('training_modules').select('id, title').in('id', moduleIds)
    : { data: [] as { id: string; title: string }[] }
  const moduleTitle = new Map((modules ?? []).map((m) => [m.id as string, m.title as string]))

  const attachedTo = (lessonId: string): { label: string; moduleId: string | null } => {
    const lesson = lessonById.get(lessonId)
    if (!lesson) return { label: 'Unknown lesson', moduleId: null }
    const course = moduleTitle.get(lesson.moduleId) ?? 'Training course'
    return { label: `${course} · ${lesson.title}`, moduleId: lesson.moduleId }
  }
  const builderHref = (moduleId: string | null): string | null =>
    moduleId ? `/admin/academy/training?tab=builder&course=${moduleId}` : null

  const rows: AdminBinaryRow[] = []

  for (const i of recItems ?? []) {
    const { label, moduleId } = attachedTo(i.id as string)
    rows.push({
      id: `rec:${i.id as string}`,
      title: `${i.title as string} (recording)`,
      fileType: 'video/mp4',
      isLink: false,
      sizeBytes: null,
      uploaderName: null,
      createdAt: i.created_at as string,
      attachedCount: 1,
      attachedObjects: [label],
      pendingFlags: 0,
      downloads: 0,
      source: 'training',
      builderHref: builderHref(moduleId),
    })
  }

  for (const r of res ?? []) {
    const { label, moduleId } = attachedTo(r.item_id as string)
    const isLink = (r.kind as string) === 'link'
    rows.push({
      id: `tr:${r.id as string}`,
      title: r.title as string,
      fileType: isLink ? 'link' : null,
      isLink,
      sizeBytes: null,
      uploaderName: null,
      createdAt: r.created_at as string,
      attachedCount: 1,
      attachedObjects: [label],
      pendingFlags: 0,
      downloads: 0,
      source: 'training',
      builderHref: builderHref(moduleId),
    })
  }

  return rows
}
