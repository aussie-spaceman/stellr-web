import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation, type AuditActor } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { auditCoalescing } from './audit-coalescing'
import {
  FILE_NAME_TOO_LONG,
  MAX_FILE_NAME_LENGTH,
  isUploadPurpose,
  signUpload,
  type UploadContext,
  type UploadPurpose,
} from '@/lib/uploads'

// POST /api/uploads/sign — the single entry point for every file upload.
//
// Returns a short-lived Supabase signed upload URL so the browser can send the
// bytes STRAIGHT to storage. Vercel rejects a request body over 4.5MB before the
// function runs and no configuration changes that, so a file of any real size
// must never pass through a route handler. Only this metadata does.
//
// Authorisation per purpose lives in lib/uploads.ts; the route that later claims
// the object re-checks the object-level rule before recording anything.

/**
 * One platform audit event for a signed URL, written after the response. Does
 * nothing while PLATFORM_AUDIT_ENABLED is off, and never fails the request. The
 * purpose is a code from our own list. The file name, the path (which holds it) and
 * the caller's context stay out: a name can say whose file it is, and the row can
 * never be erased.
 *
 * The session is read here rather than left to the deferred write, so the actor does
 * not rest on Clerk's auth() working inside after(), which is unproven. If it fails
 * here, the deferred write tries again and the row says so if it cannot name anyone.
 */
async function signingActor(): Promise<AuditActor> {
  try {
    return { userId: (await auth()).userId }
  } catch {
    return { session: true }
  }
}

async function recordSigned(purpose: UploadPurpose) {
  if (!auditEnabled()) return
  const actor = await signingActor()
  const coalescing = auditCoalescing(actor, purpose)
  if (coalescing === 'skip') return
  const tenant = await requestTenant().catch(() => null)
  await auditMutation(
    {
      action: 'upload.sign.create',
      actor,
      tenant: { tenantId: tenant?.tenantId ?? null },
      metadata: {
        purpose,
        ...(tenant ? {} : { tenant_unresolved: true }),
        ...(coalescing === 'last' ? { coalesced: true } : {}),
      },
    },
    { afterResponse: true },
  )
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))

  if (!isUploadPurpose(b.purpose)) {
    return NextResponse.json({ error: 'Unknown upload purpose' }, { status: 400 })
  }
  const fileName = (typeof b.fileName === 'string' ? b.fileName : '').trim()
  if (!fileName) return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
  // Anyone can call this route, signed in or not: refuse a long name before
  // anything reads it.
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return NextResponse.json({ error: FILE_NAME_TOO_LONG }, { status: 400 })
  }

  const result = await signUpload({
    purpose: b.purpose,
    ctx: (b.context ?? {}) as UploadContext,
    fileName,
    fileSize: Number(b.fileSize),
    contentType: typeof b.contentType === 'string' ? b.contentType : '',
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  await recordSigned(b.purpose)
  return NextResponse.json(result)
}
