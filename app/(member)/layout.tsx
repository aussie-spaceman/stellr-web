import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'
import { NavUserButton } from '@/components/layout/NavUserButton'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth()
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg tracking-tight">
            Stellr
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/account" className="text-gray-600 hover:text-gray-900">
              My Account
            </Link>
            <NavUserButton isAdmin={isAdmin} />
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-10">{children}</main>
    </div>
  )
}
