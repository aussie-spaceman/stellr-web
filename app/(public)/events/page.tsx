import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAllEvents } from '@/lib/sanity'
import { EventCard } from '@/components/ui/EventCard'
import { EventsFilterBar } from '@/components/sections/EventsFilterBar'

export const metadata: Metadata = {
  title: 'Upcoming Events',
  description: 'Design challenges across the US for middle and high school students.',
}

export const revalidate = 3600


interface StellarEvent {
  _id: string
  title: string
  slug: { current: string }
  type?: string
  gradeLevel?: string
  date?: string
  endDate?: string
  venue?: string
  city?: string
  state?: string
  tagline?: string
  image?: { asset: { _ref: string } }
  registrationOpen?: boolean
  registrationOpenDate?: string
  registrationCloseDate?: string
}

interface PageProps {
  searchParams: { type?: string; grade?: string }
}

export default async function EventsPage({ searchParams }: PageProps) {
  const allEvents: StellarEvent[] = await getAllEvents().catch(() => []) ?? []
  const events: StellarEvent[] = allEvents

  const filtered = events.filter((e) => {
    if (searchParams.type && e.type !== searchParams.type) return false
    if (searchParams.grade && e.gradeLevel !== searchParams.grade) return false
    return true
  })

  return (
    <>
      {/* Page header */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold">Upcoming Events</h1>
          <p className="mt-3 text-lg text-gray-300 max-w-xl">
            Design challenges across the US for middle and high school students.
          </p>
        </div>
      </section>

      {/* Filter bar */}
      <section className="bg-brand-grey-light border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto">
          <Suspense fallback={null}>
            <EventsFilterBar />
          </Suspense>
        </div>
      </section>

      {/* Event grid */}
      <section className="section-padding">
        <div className="container-max">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((event) => (
                <EventCard key={event._id} event={event} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-brand-grey-mid">
              <p className="text-lg">No events match your filters.</p>
              <a href="/events" className="mt-4 inline-block text-brand-blue hover:underline text-sm">
                Clear filters
              </a>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
