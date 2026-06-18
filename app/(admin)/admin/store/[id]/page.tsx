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
      <Link href="/admin/store" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Store
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
      <p className="mt-0.5 mb-4 text-sm text-gray-500">{product.slug}</p>
      <ProductForm mode="edit" product={product} printfulEnabled={printfulEnabled()} />
    </div>
  )
}
