export const teamMember = {
  name: 'teamMember',
  title: 'Team Member',
  type: 'document',
  fields: [
    { name: 'name', type: 'string', title: 'Name' },
    { name: 'role', type: 'string', title: 'Role / Title' },
    { name: 'bio', type: 'text', title: 'Bio' },
    { name: 'photo', type: 'image', title: 'Photo', options: { hotspot: true } },
    { name: 'linkedIn', type: 'url', title: 'LinkedIn URL' },
    { name: 'order', type: 'number', title: 'Display Order' },
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }],
    },
  ],
  preview: {
    select: { title: 'name', subtitle: 'role', media: 'photo' },
  },
}
