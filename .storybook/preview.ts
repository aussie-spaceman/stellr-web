import type { Preview } from '@storybook/nextjs'
// Tailwind + generated design tokens — the same stylesheet the app uses, so
// stories render in the real design system.
import '../styles/globals.css'

// The responsive contract: every component is reviewed at all three widths.
const viewports = {
  mobile: { name: 'Mobile (375)', styles: { width: '375px', height: '812px' }, type: 'mobile' as const },
  tablet: { name: 'Tablet (768)', styles: { width: '768px', height: '1024px' }, type: 'tablet' as const },
  desktop: { name: 'Desktop (1280)', styles: { width: '1280px', height: '800px' }, type: 'desktop' as const },
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    viewport: { options: viewports },
    backgrounds: {
      options: {
        surface: { name: 'Surface', value: '#F6F7FB' },
        white: { name: 'White', value: '#FFFFFF' },
        midnight: { name: 'Midnight', value: '#0E1330' },
      },
    },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  initialGlobals: {
    backgrounds: { value: 'surface' },
    viewport: { value: 'desktop', isRotated: false },
  },
}

export default preview
