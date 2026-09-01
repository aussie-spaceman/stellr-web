import { CartView } from '@/components/store/CartView'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'

export const metadata = { title: 'Your cart — Stellr Store' }

export default function CartPage() {
  return (
    <div className="section-padding">
      <div className="container-max max-w-3xl">
        <h1 className="mb-6 text-3xl font-bold text-brand-blue-dark">Your cart</h1>
        <CartView />
        <MissionFundingNote variant="store" className="mt-10" />
      </div>
    </div>
  )
}
