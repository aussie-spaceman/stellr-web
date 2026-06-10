import { SiteHeader } from '@/components/layout/SiteHeader'
import { Footer } from '@/components/layout/Footer'

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <SiteHeader />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-10">{children}</main>
      <Footer />
    </div>
  )
}
