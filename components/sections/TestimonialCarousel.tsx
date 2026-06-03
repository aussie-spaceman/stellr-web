'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { urlFor } from '@/lib/sanity'

interface Testimonial {
  _id: string
  quote: string
  author: string
  role: string
  event?: string
  videoUrl?: string
  photo?: { asset: { _ref: string } }
}

const ROLES = ['All', 'Student', 'Teacher', 'Parent', 'Mentor', 'Donor'] as const

export function TestimonialCarousel({ testimonials }: { testimonials: Testimonial[] }) {
  const [activeRole, setActiveRole] = useState<string>('All')
  const [index, setIndex] = useState(0)

  const filtered = activeRole === 'All'
    ? testimonials
    : testimonials.filter((t) => t.role === activeRole)

  const current = filtered[index] ?? null

  function handleRoleChange(role: string) {
    setActiveRole(role)
    setIndex(0)
  }

  function prev() { setIndex((i) => (i - 1 + filtered.length) % filtered.length) }
  function next() { setIndex((i) => (i + 1) % filtered.length) }

  if (!testimonials.length) return null

  return (
    <div className="max-w-3xl mx-auto">
      {/* Role filter tabs */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => handleRoleChange(role)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeRole === role
                ? 'bg-brand-blue text-white'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            {role}
          </button>
        ))}
      </div>

      {current ? (
        <div className="relative">
          <div className="flex flex-col items-center text-center px-8">
            {/* Photo */}
            {current.photo ? (
              <div className="relative w-16 h-16 rounded-full overflow-hidden mb-4 ring-2 ring-brand-blue">
                <Image
                  src={urlFor(current.photo).width(128).height(128).url()}
                  alt={current.author}
                  fill
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-brand-blue/30 flex items-center justify-center mb-4 text-xl font-bold text-white">
                {current.author.charAt(0)}
              </div>
            )}

            {/* Video thumbnail */}
            {current.videoUrl && (
              <a
                href={current.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-4 inline-flex items-center gap-2 text-sm text-blue-300 hover:text-white transition-colors"
              >
                <Play size={14} className="fill-current" /> Watch video
              </a>
            )}

            <blockquote className="text-lg sm:text-xl font-medium italic leading-relaxed text-white mb-4">
              &ldquo;{current.quote}&rdquo;
            </blockquote>
            <p className="font-semibold text-blue-300">{current.author}</p>
            <p className="text-sm text-gray-400">
              {current.role}{current.event ? ` · ${current.event}` : ''}
            </p>
          </div>

          {/* Navigation */}
          {filtered.length > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={prev}
                className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Previous testimonial"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm text-gray-400">{index + 1} / {filtered.length}</span>
              <button
                onClick={next}
                className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Next testimonial"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-gray-400 italic">No testimonials for this role yet.</p>
      )}
    </div>
  )
}
