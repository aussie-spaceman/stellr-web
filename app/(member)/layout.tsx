import { UserButton } from '@clerk/nextjs'
import Link from 'next/link'

export default function MemberLayout({ children }: { children: React.ReactNode }) {
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
            <UserButton />
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-10">{children}</main>
    </div>
  )
}
