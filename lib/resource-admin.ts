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

  const rows: AdminBinaryRow[] = bins.map((b) => {
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
    }
  })

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
