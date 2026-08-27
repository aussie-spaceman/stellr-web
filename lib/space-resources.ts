import { supabaseServer } from '@/lib/supabase'

// ─── A Space's Resources list ────────────────────────────────────────────────
//
// A space shows files from TWO places, and reading either one alone is wrong:
//
//   1. direct     — community_resources.space_id = <space>. Written by an admin
//                   upload into the space and by chat auto-save (from_chat).
//   2. catalogue  — a container_contents row on the space's container
//                   (mentoring_cohorts where container_type='space' and
//                   campaign_ref = <slug>), pointing at a binary that usually
//                   has NO space_id. Written by "Assign resource → Browse
//                   catalogue" and by attaching a link.
//
// The member page read only (1), so every catalogue-attached file was invisible
// to members while the admin console listed it — this helper is the single
// reader both sides now share.

/** Short, colour-coded file-type label for a Resources list / attachment chip. */
export function fileLabel(name: string, mime: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'IMG'
  if (ext === 'pdf' || mime === 'application/pdf') return 'PDF'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS'
  if (['doc', 'docx'].includes(ext)) return 'DOC'
  if (['ppt', 'pptx'].includes(ext)) return 'PPT'
  if (['dwg', 'dxf', 'step', 'stp', 'stl', 'f3d'].includes(ext)) return 'CAD'
  if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP'
  return (ext || 'file').toUpperCase().slice(0, 4)
}

/**
 * community_resources.file_type holds "a mime type or a short label, per
 * caller" (lib/resource-finalise) — catalogue uploads store the mime, space
 * uploads store the label. Normalise to the label so a catalogue file badges as
 * "PDF" rather than "application/pdf".
 */
export function normaliseFileType(raw: string | null, title: string): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (v.toLowerCase() === 'link') return 'LINK'
  if (!v.includes('/')) return v.toUpperCase().slice(0, 4)
  return fileLabel(title, v.toLowerCase())
}

export interface SpaceResource {
  /** community_resources id (the binary). */
  id: string
  title: string
  /** Normalised short label — PDF / IMG / LINK / … */
  fileType: string | null
  kind: 'file' | 'link'
  fromChat: boolean
  sizeBytes: number | null
  createdAt: string
  uploaderName: string | null
  /**
   * container_contents id when the file is LINKED from the global catalogue —
   * opens via the container-gated attachment route, and admin "Detach" removes
   * the link only. Null for files uploaded into this space, which open by
   * binary id and whose admin "Remove" deletes the binary.
   */
  attachmentId: string | null
}

type Rel = { first_name: string | null; last_name: string | null }
const nameOf = (u: Rel | Rel[] | null): string | null => {
  const r = Array.isArray(u) ? u[0] ?? null : u
  return r ? [r.first_name, r.last_name].filter(Boolean).join(' ') || null : null
}

/** Every resource in a space: direct uploads + catalogue links, newest first. */
export async function listSpaceResources(spaceId: string, spaceSlug: string): Promise<SpaceResource[]> {
  const db = supabaseServer()

  const [{ data: direct }, { data: containerRow }] = await Promise.all([
    db
      .from('community_resources')
      .select('id, title, file_type, from_chat, file_size_bytes, created_at, members:uploaded_by(first_name, last_name)')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false }),
    db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', 'space')
      .eq('campaign_ref', spaceSlug)
      .maybeSingle(),
  ])

  type DirectRow = {
    id: string
    title: string
    file_type: string | null
    from_chat: boolean
    file_size_bytes: number | null
    created_at: string
    members: Rel | Rel[] | null
  }
  const out: SpaceResource[] = ((direct ?? []) as unknown as DirectRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    fileType: normaliseFileType(r.file_type, r.title),
    kind: (r.file_type ?? '').toLowerCase() === 'link' ? 'link' : 'file',
    fromChat: !!r.from_chat,
    sizeBytes: r.file_size_bytes,
    createdAt: r.created_at,
    uploaderName: nameOf(r.members),
    attachmentId: null,
  }))

  const containerId = (containerRow as { id: string } | null)?.id ?? null
  if (containerId) {
    const { data: cc } = await db
      .from('container_contents')
      .select('id, content_ref, display_name, created_at')
      .eq('container_id', containerId)
      .eq('content_type', 'resource')
    const ccRows = (cc ?? []) as Array<{ id: string; content_ref: string; display_name: string | null; created_at: string }>
    const refs = ccRows.map((r) => r.content_ref)
    if (refs.length) {
      // content_ref has no FK, so resolve the binaries in a second query.
      const { data: bins } = await db
        .from('community_resources')
        .select('id, title, file_type, space_id, file_size_bytes, storage_path, members:uploaded_by(first_name, last_name)')
        .in('id', refs)
      type BinRow = {
        id: string
        title: string
        file_type: string | null
        space_id: string | null
        file_size_bytes: number | null
        storage_path: string | null
        members: Rel | Rel[] | null
      }
      const binById = new Map(((bins ?? []) as unknown as BinRow[]).map((x) => [x.id, x]))
      for (const row of ccRows) {
        const bin = binById.get(row.content_ref)
        if (!bin) continue
        // Files uploaded to THIS space are already listed above (attachSpaceResource
        // mirrors them onto the container too). Skip to avoid a duplicate row.
        if (bin.space_id === spaceId) continue
        const title = row.display_name?.trim() || bin.title
        out.push({
          id: bin.id,
          title,
          fileType: normaliseFileType(bin.file_type, bin.title),
          kind: (bin.file_type ?? '').toLowerCase() === 'link' || !bin.storage_path ? 'link' : 'file',
          fromChat: false,
          sizeBytes: bin.file_size_bytes,
          createdAt: row.created_at,
          uploaderName: nameOf(bin.members),
          attachmentId: row.id,
        })
      }
    }
  }

  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}
