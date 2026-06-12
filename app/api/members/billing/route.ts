import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import Stripe from 'stripe'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// GET /api/members/billing — returns Stripe invoices + participation payment history
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, stripe_customer_id, event_role')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // ── Stripe invoices (only when they have a Stripe customer record) ────────────
  let invoices: object[] = []
  if (member.stripe_customer_id) {
    try {
      const stripe = getStripe()
      const invoiceList = await stripe.invoices.list({
        customer: member.stripe_customer_id,
        limit: 100,
        expand: ['data.charge'],
      })
      invoices = invoiceList.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        created: inv.created,
        due_date: inv.due_date,
        status: inv.status,
        amount_due: inv.amount_due,
        amount_paid: inv.amount_paid,
        currency: inv.currency,
        description: inv.description ?? inv.lines.data[0]?.description ?? null,
        pdf_url: inv.invoice_pdf,
        hosted_url: inv.hosted_invoice_url,
      }))
    } catch (err) {
      console.error('[billing] Stripe error:', err)
    }
  }

  // ── Participation payment history (all roles) ─────────────────────────────────
  // join_completed_at is only set by the group-join flow; individual registrations
  // never have it, so those are kept via registrations.type instead.
  const { data: participationRows } = await db
    .from('participants')
    .select(`
      id, event_role, join_completed_at, individual_payment_status, school_name,
      registrations(
        id, event_slug, event_title, school_name, status, created_at, type,
        member_pays_individually, invoice_requested,
        teacher_first_name, teacher_last_name, teacher_member_id
      )
    `)
    .eq('member_id', member.id)

  type ParticipationReg = {
    created_at: string; type: string | null; status?: string | null
    member_pays_individually?: boolean; teacher_member_id?: string | null
  }
  const regOf = (p: { registrations: ParticipationReg | ParticipationReg[] | null }) =>
    Array.isArray(p.registrations) ? p.registrations[0] : p.registrations

  const participations = (participationRows ?? [])
    .filter(p => p.join_completed_at !== null || regOf(p)?.type === 'individual')
    .sort((a, b) => {
      const dateOf = (p: typeof a) => p.join_completed_at ?? regOf(p)?.created_at ?? ''
      return dateOf(b).localeCompare(dateOf(a))
    })
    // Annotate each row with who can pay: 'self' (the member owes — active "Pay
    // now"), 'organiser' (a group payment the organiser owes — greyed for
    // members), or null (settled / nothing due). is_owner lets the UI tailor the
    // organiser message for teachers / student managers.
    .map(p => {
      const reg = regOf(p)
      let pay_kind: 'self' | 'organiser' | null = null
      if (reg) {
        const open = reg.status !== 'confirmed' && reg.status !== 'cancelled'
        if (reg.type === 'individual') {
          if (open) pay_kind = 'self'
        } else if (reg.member_pays_individually) {
          if (p.individual_payment_status === 'pending') pay_kind = 'self'
        } else if (open) {
          pay_kind = 'organiser'
        }
      }
      return { ...p, pay_kind, is_owner: !!reg && reg.teacher_member_id === member.id }
    })

  // ── Account credits (issued from cancelled registrations) ────────────────────
  const nowIso = new Date().toISOString()
  const { data: creditRows } = await db
    .from('account_credits')
    .select('id, currency, amount_cents, remaining_cents, status, reason, expires_at, created_at')
    .eq('member_id', member.id)
    .in('status', ['available', 'partially_redeemed'])
    .gt('remaining_cents', 0)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('expires_at', { ascending: true, nullsFirst: false })

  return NextResponse.json({ invoices, participations, credits: creditRows ?? [] })
}
