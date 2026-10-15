import { tokens } from '@/lib/tokens'

/**
 * Shared look for Clerk's sign-in and sign-up cards.
 *
 * - Fields are 16px: Clerk's default (about 13px) makes iOS Safari zoom the
 *   page in when a field is focused.
 * - Brand colour is primary-deep, which keeps white button text above the
 *   4.5:1 contrast minimum.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: tokens.color.primaryDeep,
    fontFamily: `${tokens.font.body}, system-ui, sans-serif`,
  },
  elements: {
    formFieldInput: { fontSize: tokens.fontSize.input, minHeight: '44px' },
    formButtonPrimary: { minHeight: '44px' },
    socialButtonsBlockButton: { minHeight: '44px' },
    card: { maxWidth: '100%' },
    rootBox: { maxWidth: '100%' },
  },
} as const
