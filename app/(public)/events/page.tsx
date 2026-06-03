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

// Fallback events before Sanity is seeded
const FALLBACK_EVENTS = [
  { _id: '1', title: 'Nevada Space Design Challenge', slug: { current: 'nevada-space-design-challenge-2026' }, date: '2026-11-06', endDate: '2026-11-07', venue: 'UNLV', city: 'Las Vegas', state: 'NV', gradeLevel: 'High School', type: 'Space Design Challenge', tagline: 'Design a habitat for the next generation of space explorers.', registrationOpen: false, registrationOpenDate: '2026-08-01' },
  { _id: '2', title: 'Minnesota Environmental Design Challenge', slug: { current: 'minnesota-environmental-design-challenge-2026' }, date: '2026-11-24', venue: 'MSU Mankato', city: 'Mankato', state: 'MN', gradeLevel: 'High School', type: 'Environmental Design Challenge', tagline: 'Engineer solutions to real-world environmental problems.', registrationOpen: false, registrationOpenDate: '2026-08-01' },
  { _id: '3', title: 'North Carolina Space Design Challenge', slug: { current: 'north-carolina-space-design-challenge-2027' }, date: '2027-02-06', venue: "St Mary's School", city: 'Raleigh', state: 'NC', gradeLevel: 'High School', type: 'Space Design Challenge', tagline: 'Push the boundaries of space architecture.', registrationOpen: false, registrationOpenDate: '2026-10-01' },
]

interface PageProps {
  searchParams: { type?: string; grade?: string }
}

export default async function EventsPage({ searchParams }: PageProps) {
  const allEvents = await getAllEvents().catch(() => FALLBACK_EVENTS)
  const events = allEvents?.length ? allEvents : FALLBACK_EVENTS

  const filtered = events.filter((e: { type?: string; gradeLevel?: string }) => {
    if (searchParams.type && e.type !== searchParams.type) return false
    if (searchParams.grade && e.gradeLevel !== searchParams.grade) return false
    return true
  })

  return (
    <>
      {/* Page header */}
      <section className="bg-brand-navy text-white py-16 px-4 sm:px-6 lg:px-8">
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
