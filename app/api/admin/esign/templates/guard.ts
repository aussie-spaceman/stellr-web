import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { TemplateAdminError } from '@/lib/esign/native/template-admin'

// Shared by the agreement-document editor routes: admins only, and errors
// that tell the admin what to fix.

export const noStore = { 'Cache-Control': 'private, no-store' }

/** The signed-in admin's name for the record, or null when the caller is not an admin. */
export async function adminName(): Promise<string | null> {
  const { userId, sessionClaims } = await auth()
  if (!userId || !isAdminClaims(sessionClaims)) return null
  const user = await currentUser().catch(() => null)
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ')
  return name ? `${name} (${userId})` : userId
}

export const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: noStore })

export function failure(err: unknown) {
  if (err instanceof TemplateAdminError) {
    return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422, headers: noStore })
  }
  console.error('[admin/esign/templates]', err)
  return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500, headers: noStore })
}
