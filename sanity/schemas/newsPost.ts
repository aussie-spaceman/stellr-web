export const newsPost = {
  name: 'newsPost',
  title: 'News & Announcements',
  type: 'document',
  fields: [
    { name: 'title', type: 'string', title: 'Title' },
    { name: 'slug', type: 'slug', title: 'Slug', options: { source: 'title' } },
    { name: 'publishedAt', type: 'datetime', title: 'Published At' },
    {
      name: 'category',
      type: 'string',
      title: 'Category',
      options: { list: ['Announcement', 'Event Results', 'STEM News', 'Community'] },
    },
    { name: 'excerpt', type: 'text', title: 'Excerpt', rows: 3 },
    {
      name: 'body',
      type: 'array',
      title: 'Body',
      of: [{ type: 'block' }, { type: 'image', options: { hotspot: true } }],
    },
    { name: 'coverImage', type: 'image', title: 'Cover Image', options: { hotspot: true } },
  ],
  orderings: [
    {
      title: 'Published Date, Newest First',
      name: 'publishedAtDesc',
      by: [{ field: 'publishedAt', direction: 'desc' }],
    },
  ],
  preview: {
    select: { title: 'title', subtitle: 'publishedAt', media: 'coverImage' },
  },
}
