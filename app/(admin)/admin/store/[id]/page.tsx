import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getProduct } from '@/lib/store/products'
import { printfulEnabled } from '@/lib/store/printful'
import { ProductForm } from '@/components/admin/store/ProductForm'

export const metadata = { title: 'Admin — Edit product' }
export const dynamic = 'force-dynamic'

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) notFound()

  return (
    <div>
      <Link href="/admin/store" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-blue-dark">
        <ArrowLeft className="h-4 w-4" /> Store
      </Link>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">{product.name}</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">{product.slug}</p>
      <ProductForm mode="edit" product={product} printfulEnabled={printfulEnabled()} />
    </div>
  )
}
