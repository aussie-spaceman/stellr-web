import Link from 'next/link'
import { CheckCircle } from 'lucide-react'
import { ClearCartOnLoad } from '@/components/store/ClearCartOnLoad'

export const metadata = { title: 'Order confirmed — Stellr Store' }

export default function StoreSuccessPage() {
  return (
    <div className="section-padding">
      <div className="container-max max-w-xl text-center">
        <ClearCartOnLoad />
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h1 className="mb-2 text-3xl font-bold text-brand-blue-dark">Thank you for your order!</h1>
        <p className="mb-6 text-brand-grey-dark">
          Your order is confirmed and a receipt is on its way to your inbox. We&apos;ll email tracking once it ships.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/store" className="rounded-md bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue-dark">
            Continue shopping
          </Link>
          <Link href="/account?tab=activity" className="rounded-md border border-gray-200 px-5 py-2.5 text-sm font-semibold text-brand-blue hover:bg-gray-50">
            View order history
          </Link>
        </div>
      </div>
    </div>
  )
}
