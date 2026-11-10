import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Eyebrow } from './primitives'

const meta: Meta = { title: 'Primitives/Eyebrow' }
export default meta

export const Eyebrows: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-col gap-3">
      <Eyebrow>Start here</Eyebrow>
      <Eyebrow className="text-space-violet">Theme</Eyebrow>
      <Eyebrow className="text-enviro-green-text">Included</Eyebrow>
    </div>
  ),
}
