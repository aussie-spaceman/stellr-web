import { createClient } from 'next-sanity'
import imageUrlBuilder from '@sanity/image-url'
import type { SanityImageSource } from '@sanity/image-url/lib/types/types'

export const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const apiVersion = '2024-01-01'

// Only create the client when a real project ID is present.
// During build without env vars configured, all queries return null/[] via the
// fallback data in each page — no client needed.
const sanityConfigured = Boolean(projectId && projectId.length > 0)

export const client = sanityConfigured
  ? createClient({
      projectId: projectId!,
      dataset,
      apiVersion,
      useCdn: false,
      token: process.env.SANITY_API_TOKEN,
      perspective: 'published',
    })
  : null

const builder = client ? imageUrlBuilder(client) : null

export function urlFor(source: SanityImageSource) {
  // builder is only null when Sanity isn't configured.
  // In that case we never have real image sources, so this cast is safe.
  return builder!.image(source)
}

// ── Shared types ──────────────────────────────────────────────────────────────
// Core event shape returned by the event queries below.
export interface StellarEvent {
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

// ── GROQ Queries ──────────────────────────────────────────────────────────────
// Every query returns null when Sanity is not configured.
// Pages handle null by falling back to static seed data.

export async function getFeaturedEvents() {
  if (!client) return null
  // Only surface live events on the homepage — campaigns have their own page.
  // The !defined(activityType) guard keeps existing documents visible before migration.
  return client.fetch(`
    *[_type == "event" && featured == true && (activityType == "live_event" || !defined(activityType))] | order(date asc) [0...3] {
      _id, title, slug, type, gradeLevel, date, endDate, activityType, setting,
      venue, city, state, tagline, image, registrationOpen,
      registrationOpenDate, registrationCloseDate
    }
  `)
}

export async function getAllEvents() {
  if (!client) return null
  // Excludes campaigns — those are fetched via getAllCampaigns().
  return client.fetch(`
    *[_type == "event" && (activityType == "live_event" || !defined(activityType))] | order(date asc) {
      _id, title, slug, type, gradeLevel, date, endDate, activityType, setting,
      venue, city, state, tagline, image, registrationOpen,
      registrationOpenDate, registrationCloseDate, featured
    }
  `)
}

export async function getAllCampaigns() {
  if (!client) return null
  // Ordered by year asc, then season desc ('spring' > 'fall' alphabetically,
  // which matches chronological order within a year: Spring Jan–Apr, Fall Aug–Dec).
  return client.fetch(`
    *[_type == "event" && activityType == "campaign"] | order(campaignYear asc, season desc) {
      _id, title, slug, type, season, campaignYear,
      registrationOpen, tagline, image
    }
  `)
}

export async function getEventBySlug(slug: string) {
  if (!client) return null
  return client.fetch(
    `*[_type == "event" && slug.current == $slug][0] {
      _id, title, slug, type, gradeLevel, date, endDate, activityType, setting, term,
      venue, city, state, tagline, description, image,
      registrationOpen, registrationOpenDate, registrationCloseDate,
      capacity, eligibility, stripePriceId
    }`,
    { slug }
  )
}

export async function getFeaturedTestimonials() {
  if (!client) return null
  return client.fetch(`
    *[_type == "testimonial" && featured == true] {
      _id, quote, author, role, event, videoUrl, photo
    }
  `)
}

export async function getTestimonialsByRole(role: string) {
  if (!client) return null
  return client.fetch(
    `*[_type == "testimonial" && role == $role] {
      _id, quote, author, role, event, videoUrl, photo
    }`,
    { role }
  )
}

export async function getTeamMembers() {
  if (!client) return null
  return client.fetch(`
    *[_type == "teamMember"] | order(order asc) {
      _id, name, role, bio, photo, linkedIn
    }
  `)
}

export async function getAllNewsPosts() {
  if (!client) return null
  return client.fetch(`
    *[_type == "newsPost"] | order(publishedAt desc) {
      _id, title, slug, publishedAt, category, excerpt, coverImage
    }
  `)
}

export async function getNewsPostBySlug(slug: string) {
  if (!client) return null
  return client.fetch(
    `*[_type == "newsPost" && slug.current == $slug][0] {
      _id, title, slug, publishedAt, category, excerpt, body, coverImage
    }`,
    { slug }
  )
}

export async function getRelatedNewsPosts(category: string, excludeId: string) {
  if (!client) return null
  return client.fetch(
    `*[_type == "newsPost" && category == $category && _id != $excludeId] | order(publishedAt desc) [0...3] {
      _id, title, slug, publishedAt, category, excerpt, coverImage
    }`,
    { category, excludeId }
  )
}

export async function getSiteSettings() {
  if (!client) return null
  return client.fetch(`*[_type == "siteSettings"][0]`)
}
