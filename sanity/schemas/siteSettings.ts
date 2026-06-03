export const siteSettings = {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    { name: 'contactEmail', type: 'string', title: 'Contact Email' },
    { name: 'socialLinkedIn', type: 'url', title: 'LinkedIn URL' },
    { name: 'socialInstagram', type: 'url', title: 'Instagram URL' },
    { name: 'socialFacebook', type: 'url', title: 'Facebook URL' },
    { name: 'socialTwitter', type: 'url', title: 'X / Twitter URL' },
    { name: 'donationUrl', type: 'url', title: 'Stripe Donation Link' },
    { name: 'memberLoginUrl', type: 'url', title: 'Member Portal Login URL' },
    { name: 'memberSignupUrl', type: 'url', title: 'Member Portal Sign-up URL' },
  ],
}
