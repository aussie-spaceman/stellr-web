'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'Space Design Challenge', label: 'Space Design' },
  { value: 'Environmental Design Challenge', label: 'Environmental Design' },
  { value: 'Virtual', label: 'Virtual' },
]

const GRADE_OPTIONS = [
  { value: '', label: 'All Grades' },
  { value: 'Middle School', label: 'Middle School' },
  { value: 'High School', label: 'High School' },
]

export function EventsFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const type = searchParams.get('type') ?? ''
  const grade = searchParams.get('grade') ?? ''

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`${pathname}?${params.toString()}`)
    },
    [searchParams, pathname, router]
  )

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Type filter */}
      <div className="flex flex-wrap gap-2">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setParam('type', opt.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              type === opt.value
                ? 'bg-brand-blue text-white border-brand-blue'
                : 'bg-white text-brand-grey-dark border-gray-200 hover:border-brand-blue hover:text-brand-blue'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-gray-200 hidden sm:block" />

      {/* Grade filter */}
      <div className="flex flex-wrap gap-2">
        {GRADE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setParam('grade', opt.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              grade === opt.value
                ? 'bg-brand-navy text-white border-brand-navy'
                : 'bg-white text-brand-grey-dark border-gray-200 hover:border-brand-navy hover:text-brand-navy'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
