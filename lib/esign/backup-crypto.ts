import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Encryption for the off-site copy of signed records. Everything is encrypted
// before it leaves our systems, with a key held only in Stellr's environment
// and the owner's password manager, so the backup provider stores bytes it
// cannot read.
//
// Format (version 1):
//   "SEB1" | 12-byte IV | 16-byte GCM tag | ciphertext
// AES-256-GCM authenticates as well as encrypts: a tampered or truncated copy
// fails to decrypt rather than decrypting to something wrong.

const MAGIC = Buffer.from('SEB1')
const IV_BYTES = 12
const TAG_BYTES = 16

export class BackupKeyError extends Error {}

/** The 32-byte key from ESIGN_BACKUP_KEY (base64). */
export function backupKey(raw = process.env.ESIGN_BACKUP_KEY): Buffer {
  if (!raw) throw new BackupKeyError('ESIGN_BACKUP_KEY is not set; signed records cannot be backed up')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new BackupKeyError('ESIGN_BACKUP_KEY must be 32 bytes, base64-encoded')
  return key
}

export function backupConfigured(): boolean {
  try {
    backupKey()
    return !!process.env.ESIGN_BACKUP_DRIVE_FOLDER_ID
  } catch {
    return false
  }
}

export function encryptBackup(plain: Uint8Array, key = backupKey()): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function decryptBackup(sealed: Uint8Array, key = backupKey()): Buffer {
  const buf = Buffer.from(sealed)
  if (buf.length < MAGIC.length + IV_BYTES + TAG_BYTES || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Not a Stellr signed-record backup')
  }
  const iv = buf.subarray(4, 4 + IV_BYTES)
  const tag = buf.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(buf.subarray(4 + IV_BYTES + TAG_BYTES)), decipher.final()])
}
