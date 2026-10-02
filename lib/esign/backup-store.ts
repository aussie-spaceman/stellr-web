import { Readable } from 'node:stream'
import { drive as driveApi } from '@googleapis/drive'
import { JWT } from 'google-auth-library'

// The off-site store for encrypted copies of signed records: a Google
// Workspace shared-drive folder (ESIGN_BACKUP_DRIVE_FOLDER_ID), reached with
// the service account the roster spreadsheets already use. Kept behind this
// small interface so tests run against memory and the store can change
// without touching the replication logic.

export interface BackupStore {
  put(name: string, bytes: Uint8Array): Promise<void>
  get(name: string): Promise<Uint8Array | null>
  remove(name: string): Promise<boolean>
  /** Names beginning with `prefix`, newest first. */
  list(prefix: string): Promise<string[]>
}

function auth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Google service account is not configured')
  return new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: process.env.GOOGLE_IMPERSONATE_USER ?? process.env.GOOGLE_SHEET_OWNER_EMAIL,
  })
}

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export function driveBackupStore(folderId = process.env.ESIGN_BACKUP_DRIVE_FOLDER_ID): BackupStore {
  if (!folderId) throw new Error('ESIGN_BACKUP_DRIVE_FOLDER_ID is not set')
  const drive = driveApi({ version: 'v3', auth: auth() })
  const common = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const

  async function find(name: string): Promise<string | null> {
    const res = await drive.files.list({
      ...common,
      q: `name = '${escape(name)}' and '${escape(folderId as string)}' in parents and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    })
    return res.data.files?.[0]?.id ?? null
  }

  return {
    async put(name, bytes) {
      if (await find(name)) return // Write-once: an existing copy is kept.
      await drive.files.create({
        supportsAllDrives: true,
        requestBody: { name, parents: [folderId], mimeType: 'application/octet-stream' },
        media: { mimeType: 'application/octet-stream', body: Readable.from(Buffer.from(bytes)) },
        fields: 'id',
      })
    },
    async get(name) {
      const id = await find(name)
      if (!id) return null
      const res = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
      return new Uint8Array(res.data as ArrayBuffer)
    },
    async remove(name) {
      const id = await find(name)
      if (!id) return false
      await drive.files.delete({ fileId: id, supportsAllDrives: true })
      return true
    },
    async list(prefix) {
      const res = await drive.files.list({
        ...common,
        q: `name contains '${escape(prefix)}' and '${escape(folderId as string)}' in parents and trashed = false`,
        fields: 'files(name)',
        orderBy: 'createdTime desc',
        pageSize: 1000,
      })
      return (res.data.files ?? []).map((f) => f.name as string).filter((n) => n.startsWith(prefix))
    },
  }
}

/** For tests and the dry-run path. */
export function memoryBackupStore(): BackupStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    async put(name, bytes) { if (!files.has(name)) files.set(name, new Uint8Array(bytes)) },
    async get(name) { return files.get(name) ?? null },
    async remove(name) { return files.delete(name) },
    async list(prefix) { return [...files.keys()].filter((n) => n.startsWith(prefix)).sort().reverse() },
  }
}
