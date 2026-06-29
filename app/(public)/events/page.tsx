import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getAllEvents, type StellarEvent } from '@/lib/sanity'
import { EventCard } from '@/components/ui/EventCard'
import { EventsFilterBar } from '@/components/sections/EventsFilterBar'
import { VideoTestimonial } from '@/components/sections/VideoTestimonial'

export const metadata: Metadata = {
  title: 'Upcoming Events',
  description: 'Design challenges across the US for middle and high school students.',
}

export const revalidate = 3600


interface PageProps {
  searchParams: Promise<{ type?: string; grade?: string }>
}

export default async function EventsPage({ searchParams }: PageProps) {
  const { type, grade } = await searchParams
  const allEvents: StellarEvent[] = await getAllEvents().catch(() => []) ?? []

  const filtered = allEvents.filter((e) => {
    if (type && e.type !== type) return false
    if (grade && e.gradeLevel !== grade) return false
    return true
  })

  return (
    <>
      {/* Page header */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold">Upcoming Events</h1>
          <p className="mt-3 text-lg text-content-faint max-w-xl">
            Design challenges across the US for middle and high school students.
          </p>
        </div>
      </section>

      {/* Filter bar */}
      <section className="bg-brand-grey-light border-b border-line px-4 sm:px-6 lg:px-8 py-4">
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

      {/* Testimonial */}
      <section className="section-padding bg-brand-grey-light border-t border-line">
        <div className="container-max max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">In their words</p>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">Hear from a participant</h2>
          <VideoTestimonial fileId="1J-SLsgvw1pLv8Uh5w0K9UVEvqk4TnLV1" title="Stellr event testimonial" />
        </div>
      </section>
    </>
  )
}
