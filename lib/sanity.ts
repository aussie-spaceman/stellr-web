import { createClient } from 'next-sanity'
import imageUrlBuilder from '@sanity/image-url'
import type { SanityImageSource } from '@sanity/image-url/lib/types/types'

export const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!
export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const apiVersion = '2024-01-01'

export const client = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: true,
})

const builder = imageUrlBuilder(client)
export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}

// ── GROQ Queries ──────────────────────────────────────────────────────────────

export async function getFeaturedEvents() {
  return client.fetch(`
    *[_type == "event" && featured == true] | order(date asc) [0...3] {
      _id, title, slug, type, gradeLevel, date, endDate,
      venue, city, state, tagline, image, registrationOpen,
      registrationOpenDate, registrationCloseDate
    }
  `)
}

export async function getAllEvents() {
  return client.fetch(`
    *[_type == "event"] | order(date asc) {
      _id, title, slug, type, gradeLevel, date, endDate,
      venue, city, state, tagline, image, registrationOpen,
      registrationOpenDate, registrationCloseDate, featured
    }
  `)
}

export async function getEventBySlug(slug: string) {
  return client.fetch(
    `*[_type == "event" && slug.current == $slug][0] {
      _id, title, slug, type, gradeLevel, date, endDate,
      venue, city, state, tagline, description, image,
      registrationOpen, registrationOpenDate, registrationCloseDate,
      capacity, eligibility
    }`,
    { slug }
  )
}

export async function getFeaturedTestimonials() {
  return client.fetch(`
    *[_type == "testimonial" && featured == true] {
      _id, quote, author, role, event, videoUrl, photo
    }
  `)
}

export async function getTestimonialsByRole(role: string) {
  return client.fetch(
    `*[_type == "testimonial" && role == $role] {
      _id, quote, author, role, event, videoUrl, photo
    }`,
    { role }
  )
}

export async function getTeamMembers() {
  return client.fetch(`
    *[_type == "teamMember"] | order(order asc) {
      _id, name, role, bio, photo, linkedIn
    }
  `)
}

export async function getAllNewsPosts() {
  return client.fetch(`
    *[_type == "newsPost"] | order(publishedAt desc) {
      _id, title, slug, publishedAt, category, excerpt, coverImage
    }
  `)
}

export async function getNewsPostBySlug(slug: string) {
  return client.fetch(
    `*[_type == "newsPost" && slug.current == $slug][0] {
      _id, title, slug, publishedAt, category, excerpt, body, coverImage
    }`,
    { slug }
  )
}

export async function getRelatedNewsPosts(category: string, excludeId: string) {
  return client.fetch(
    `*[_type == "newsPost" && category == $category && _id != $excludeId] | order(publishedAt desc) [0...3] {
      _id, title, slug, publishedAt, category, excerpt, coverImage
    }`,
    { category, excludeId }
  )
}

export async function getSiteSettings() {
  return client.fetch(`*[_type == "siteSettings"][0]`)
}
