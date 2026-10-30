// ── The registration desk: shared shapes and pure rules ──────────────────────
//
// Used by the desk console (components/admin/CheckInLive.tsx), its API
// (app/api/admin/events/[slug]/check-in) and the code signer
// (lib/check-in-codes.ts). No server imports, so the console can use it too.
//
// Oct 2026 (check-in app review): school groups arrive by the busload, so the
// desk checks in a whole group at once, scans codes, keeps working through a
// Wi-Fi drop, and flags what staff need to know about a student on arrival.

export interface DeskCompany {
  number: number
  name: string | null
}

export interface DeskParticipant {
  id: string
  registrationId: string
  firstName: string
  lastName: string
  eventRole: string | null
  schoolName: string | null
  shirtSize: string | null
  checkedInAt: string | null
  checkInMethod: string | null
  company: DeskCompany | null
  merch: { name: string; qty: number }[]
  merchCollected: boolean
}

/** A school group: one group registration, organised by a teacher. */
export interface DeskGroup {
  id: string
  label: string
  teacher: string | null
}

/**
 * What staff should know when someone arrives. Never blocks check-in: an
 * unsigned agreement is flagged, and the desk decides (David, 30 Oct 2026).
 */
export interface DeskFlags {
  /** e.g. "Not Issued", "Partially Complete · 1 of 2" — null when signed or not needed. */
  agreement: string | null
  /** Who still has to sign, e.g. "Awaiting Tamara Buk (parent/guardian)". */
  agreementDetail: string | null
  /** e.g. "Invoice unpaid" — null when paid or free. */
  unpaid: string | null
  medical: string | null
  dietary: string[]
}

/** The teacher to call when a group is missing. */
export interface DeskContact {
  name: string | null
  phone: string | null
  email: string | null
}

/** Loaded once and every few minutes, not on every poll: these rarely change. */
export interface DeskDetails {
  flags: Record<string, DeskFlags>
  contacts: Record<string, DeskContact>
}

export type ArrivalFilter = 'all' | 'waiting' | 'arrived'

// ── Codes ────────────────────────────────────────────────────────────────────

export type CheckInCodeKind = 'p' | 'g'

const CODE = /^([pg])\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{22})$/i

/** The kind and id a code names. Not proof: only the server can verify the signature. */
export function parseCheckInCode(code: string | null | undefined): { kind: CheckInCodeKind; id: string } | null {
  const m = CODE.exec(code?.trim() ?? '')
  return m ? { kind: m[1].toLowerCase() as CheckInCodeKind, id: m[2].toLowerCase() } : null
}

/** The code in whatever a scanner read: the code page link the QR holds, or a bare code. */
export function codeFromScan(text: string): string | null {
  const raw = text.trim()
  let candidate = raw
  try {
    const c = new URL(raw).searchParams.get('c')
    if (c) candidate = c
  } catch {
    /* not a link: a bare code */
  }
  return parseCheckInCode(candidate) ? candidate : null
}

// ── Lists ────────────────────────────────────────────────────────────────────

/** Fixed order: first name, then last name. Never by arrival time, so rows don't move under a finger. */
export function compareByFirstName(a: DeskParticipant, b: DeskParticipant): number {
  return (
    a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' }) ||
    a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  )
}

const fold = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/** A search box match on the student's name, their school, or their group's school or teacher. */
export function deskSearchMatches(p: DeskParticipant, query: string, group?: DeskGroup | null): boolean {
  const q = fold(query).trim()
  if (!q) return true
  return [`${p.firstName} ${p.lastName}`, p.schoolName, group?.label, group?.teacher].some((s) => fold(s).includes(q))
}

export interface GroupRow {
  group: DeskGroup
  /** First-name order, like the people list. */
  members: DeskParticipant[]
  arrived: number
  total: number
}

/** One row per school group, in a fixed A–Z order by school then teacher. */
export function buildGroupRows(groups: DeskGroup[], participants: DeskParticipant[]): GroupRow[] {
  const byRegistration = new Map<string, DeskParticipant[]>()
  for (const p of participants) {
    const list = byRegistration.get(p.registrationId) ?? []
    list.push(p)
    byRegistration.set(p.registrationId, list)
  }
  return groups
    .map((group) => {
      const members = [...(byRegistration.get(group.id) ?? [])].sort(compareByFirstName)
      return { group, members, arrived: members.filter((m) => m.checkedInAt).length, total: members.length }
    })
    .filter((row) => row.total > 0)
    .sort(
      (a, b) =>
        a.group.label.localeCompare(b.group.label, 'en', { sensitivity: 'base' }) ||
        (a.group.teacher ?? '').localeCompare(b.group.teacher ?? '', 'en', { sensitivity: 'base' }) ||
        a.group.id.localeCompare(b.group.id)
    )
}

export function groupMatchesFilter(row: GroupRow, filter: ArrivalFilter): boolean {
  if (filter === 'waiting') return row.arrived < row.total
  if (filter === 'arrived') return row.arrived === row.total
  return true
}

export function groupMatchesSearch(row: GroupRow, query: string): boolean {
  return !query.trim() || row.members.some((m) => deskSearchMatches(m, query, row.group))
}

// ── Flags ────────────────────────────────────────────────────────────────────

const NOTHING = new Set(['none', 'n/a', 'na', 'no', 'nil', 'nothing', '-', '—', 'no known', 'none known'])

/** A free-text note worth showing: not blank and not a way of saying "none". */
export function meaningfulNote(note: string | null | undefined): string | null {
  const t = (note ?? '').trim()
  if (!t) return null
  return NOTHING.has(t.toLowerCase().replace(/[.!]+$/, '')) ? null : t
}

export function hasFlags(f: DeskFlags | undefined): boolean {
  return !!f && !!(f.agreement || f.unpaid || f.medical || f.dietary.length)
}

// ── Check-in times from a queued tap ─────────────────────────────────────────

/** How far back a queued tap's own time is trusted (the desk was offline that long). */
export const QUEUED_TAP_MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * The time to record for a desk check-in: when the tap happened, if the desk
 * sent it and it is plausible (not in the future, not older than a working
 * day), so a tap that waited out a Wi-Fi drop keeps its real arrival time.
 */
export function checkInTime(sentAt: unknown, now: Date = new Date()): string {
  if (typeof sentAt === 'string') {
    const t = Date.parse(sentAt)
    if (!Number.isNaN(t) && t <= now.getTime() + 2 * 60 * 1000 && t >= now.getTime() - QUEUED_TAP_MAX_AGE_MS) {
      return new Date(Math.min(t, now.getTime())).toISOString()
    }
  }
  return now.toISOString()
}

// ── Kept on the device ───────────────────────────────────────────────────────
//
// The last list the desk saw, and the taps still waiting to send, in this
// browser's storage. A reload or a flat battery mid-queue then loses nothing,
// and the desk opens with a list even before the network answers. Both expire,
// and the saved list leaves out medical and dietary notes: a desk iPad is often
// shared, and this is a list of minors.

export const DESK_SNAPSHOT_MAX_AGE_MS = 18 * 60 * 60 * 1000

export interface QueuedAction {
  action: string
  participantId?: string
  participantIds?: string[]
  code?: string
  /** When the tap happened (ISO). */
  at?: string
  /** Who it was for, for the error line. */
  label: string
}

export const deskSnapshotKey = (slug: string) => `stellr_checkin_snapshot:${slug}`
export const deskDetailsKey = (slug: string) => `stellr_checkin_details:${slug}`
export const deskQueueKey = (slug: string) => `stellr_checkin_queue:${slug}`

/** The participants a queued tap changes. */
export function queuedIds(item: QueuedAction): string[] {
  if (item.participantIds) return item.participantIds
  if (item.participantId) return [item.participantId]
  const code = parseCheckInCode(item.code)
  return code?.kind === 'p' ? [code.id] : []
}

const CHECK_INS = new Set(['manual', 'scan', 'group_check_in'])
const UNDOS = new Set(['undo', 'group_undo'])

/**
 * What the rows should show for taps still waiting to send, so a reloaded desk
 * shows the arrivals it recorded offline instead of the server's older list.
 */
export function pendingFromQueue(queue: QueuedAction[]): Record<string, Partial<DeskParticipant>> {
  const out: Record<string, Partial<DeskParticipant>> = {}
  for (const item of queue) {
    for (const id of queuedIds(item)) {
      if (CHECK_INS.has(item.action)) out[id] = { ...out[id], checkedInAt: item.at ?? new Date().toISOString(), checkInMethod: 'manual' }
      else if (UNDOS.has(item.action)) out[id] = { ...out[id], checkedInAt: null, checkInMethod: null }
      else if (item.action === 'merch_collected') out[id] = { ...out[id], merchCollected: true }
      else if (item.action === 'merch_uncollected') out[id] = { ...out[id], merchCollected: false }
    }
  }
  return out
}

export function readDeskStore<T>(key: string, maxAgeMs: number, now = Date.now()): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; value?: T }
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > maxAgeMs) {
      window.localStorage.removeItem(key)
      return null
    }
    return parsed.value ?? null
  } catch {
    return null
  }
}

export function writeDeskStore(key: string, value: unknown, now = Date.now()): void {
  try {
    if (value === null || (Array.isArray(value) && value.length === 0)) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify({ savedAt: now, value }))
  } catch {
    /* storage full or blocked: the desk still works, it just won't survive a reload */
  }
}

/** Flags without the free text, for the copy kept on the device. */
export function flagsForStorage(details: DeskDetails): DeskDetails {
  const flags: Record<string, DeskFlags> = {}
  for (const [id, f] of Object.entries(details.flags)) {
    flags[id] = { ...f, medical: f.medical ? 'See the roster' : null, dietary: f.dietary.length ? ['See the roster'] : [] }
  }
  return { flags, contacts: details.contacts }
}
