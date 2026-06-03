export const testimonial = {
  name: 'testimonial',
  title: 'Testimonial',
  type: 'document',
  fields: [
    { name: 'quote', type: 'text', title: 'Quote' },
    { name: 'author', type: 'string', title: 'Author Name' },
    {
      name: 'role',
      type: 'string',
      title: 'Role',
      options: { list: ['Student', 'Teacher', 'Parent', 'Mentor', 'Donor'] },
    },
    { name: 'event', type: 'string', title: 'Event / Year context' },
    { name: 'videoUrl', type: 'url', title: 'Video URL (YouTube/Vimeo, optional)' },
    { name: 'photo', type: 'image', title: 'Photo', options: { hotspot: true } },
    { name: 'featured', type: 'boolean', title: 'Feature on homepage' },
  ],
  preview: {
    select: { title: 'author', subtitle: 'role' },
  },
}
