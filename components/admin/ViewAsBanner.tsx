'use client'

import Link from 'next/link'

interface Props {
  memberId: string
  memberName: string
}

export function ViewAsBanner({ memberId, memberName }: Props) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>Viewing portal as <strong>{memberName}</strong> — read only</span>
        </div>
        <Link
          href={`/admin/members/${memberId}`}
          className="text-sm font-medium text-amber-700 hover:text-amber-900 underline"
        >
          Exit view
        </Link>
      </div>
    </div>
  )
}
