import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ProductForm } from '@/components/admin/store/ProductForm'
import { StoreNav } from '../StoreNav'

export const metadata = { title: 'Admin — New product' }
export const dynamic = 'force-dynamic'

export default function NewProductPage() {
  return (
    <div>
      <Link href="/admin/store" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-blue-dark">
        <ArrowLeft className="h-4 w-4" /> Store
      </Link>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">New product</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">
        Create the product, then add variants manually or import them from Printful.
      </p>
      <StoreNav />
      <ProductForm mode="create" />
    </div>
  )
}
