import { createClient } from 'next-sanity'
import { createImageUrlBuilder } from '@sanity/image-url'
import type { SanityImageSource } from '@sanity/image-url'

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

const builder = client ? createImageUrlBuilder(client) : null

export function urlFor(source: SanityImageSource) {
  // builder is only null when Sanity isn't configured.
  // In that case we never have real image sources, so this cast is safe.
  return builder!.image(source)
}

// Route a Sanity CDN image through the on-the-fly watermark endpoint so the
// bytes the browser receives carry "© Stellr Education" baked in (self-hosted
// photos are stamped at rest; CMS images are stamped here at serve time and
// cached). Pass the finished `urlFor(...).url()` string through this.
export function wmSrc(url: string): string {
  if (!url) return url
  return `/api/img?src=${encodeURIComponent(url)}`
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
  // Campaign-only fields (activityType === 'campaign')
  activityType?: 'live_event' | 'campaign'
  season?: 'fall' | 'spring'
  campaignYear?: number
  deadline?: string
  deliverable?: string
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
    *[_type == "event" && defined(slug.current) && (activityType == "live_event" || !defined(activityType))] | order(date asc) {
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
    *[_type == "event" && activityType == "campaign" && defined(slug.current)] | order(campaignYear asc, season desc) {
      _id, title, slug, type, gradeLevel, season, campaignYear, deadline, deliverable,
      activityType, registrationOpen, tagline, image
    }
  `)
}

export async function getEventBySlug(slug: string) {
  if (!client) return null
  return client.fetch(
    `*[_type == "event" && slug.current == $slug][0] {
      _id, title, slug, type, gradeLevel, date, endDate, activityType, setting, term,
      season, campaignYear, deadline, deliverable,
      venue, city, state, tagline, description, image,
      registrationOpen, registrationOpenDate, registrationCloseDate,
      capacity, eligibility, stripePriceId, schedule[]{ time, label }
    }`,
    { slug }
  )
}

// Minimal event/campaign metadata for a set of slugs — used by the Community
// Event/Campaign portal to distinguish live events from campaigns (FR-COM-13)
// and to resolve a slug to its Sanity _id (the entitlement/material target_ref).
export interface EventMeta {
  _id: string
  title: string
  slug: { current: string }
  activityType?: string
  date?: string
}

export async function getEventsBySlugs(slugs: string[]): Promise<EventMeta[]> {
  if (!client || slugs.length === 0) return []
  return client.fetch(
    `*[_type == "event" && slug.current in $slugs]{ _id, title, slug, activityType, date }`,
    { slugs }
  )
}

// Reverse lookup: event _id → slug. Used by the training-reminders cron to map a
// training_assignment's event_ref (Sanity _id) back to the registration slug.
export async function getEventsByIds(ids: string[]): Promise<EventMeta[]> {
  if (!client || ids.length === 0) return []
  return client.fetch(
    `*[_type == "event" && _id in $ids]{ _id, title, slug, activityType, date }`,
    { ids }
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
