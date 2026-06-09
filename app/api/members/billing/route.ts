import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import Stripe from 'stripe'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

// GET /api/members/billing — returns all Stripe invoices for this member
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, stripe_customer_id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!member.stripe_customer_id) return NextResponse.json({ invoices: [] })

  const stripe = getStripe()

  const invoiceList = await stripe.invoices.list({
    customer: member.stripe_customer_id,
    limit: 100,
    expand: ['data.charge'],
  })

  const invoices = invoiceList.data.map(inv => ({
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

  return NextResponse.json({ invoices })
}
