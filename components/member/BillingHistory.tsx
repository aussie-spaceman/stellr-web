'use client'

import { useEffect, useState } from 'react'

interface Invoice {
  id: string
  number: string | null
  created: number
  due_date: number | null
  status: string | null
  amount_due: number
  amount_paid: number
  currency: string
  description: string | null
  pdf_url: string | null
  hosted_url: string | null
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  open: 'bg-yellow-100 text-yellow-700',
  void: 'bg-gray-100 text-gray-500',
  uncollectible: 'bg-red-100 text-red-600',
  draft: 'bg-gray-100 text-gray-500',
}

export function BillingHistory() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/members/billing')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setInvoices(data.invoices ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-400">Loading billing history…</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Billing History</h2>
        <p className="text-sm text-gray-500 mt-0.5">All invoices and payments for your account.</p>
      </div>

      {error && (
        <div className="p-6">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {!error && invoices.length === 0 && (
        <div className="p-6">
          <p className="text-sm text-gray-500">No invoices found.</p>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Date</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Invoice #</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Description</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Amount</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-gray-600">{formatDate(inv.created)}</td>
                  <td className="px-6 py-4 font-mono text-gray-700 text-xs">{inv.number ?? '—'}</td>
                  <td className="px-6 py-4 text-gray-700 max-w-xs truncate">{inv.description ?? '—'}</td>
                  <td className="px-6 py-4 text-gray-900 font-medium">
                    {formatAmount(inv.amount_due, inv.currency)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[inv.status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {inv.pdf_url && (
                      <a
                        href={inv.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                      >
                        PDF
                      </a>
                    )}
                    {inv.hosted_url && (
                      <a
                        href={inv.hosted_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-3 text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                      >
                        View
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
