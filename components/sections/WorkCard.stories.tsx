import type { Meta, StoryObj } from '@storybook/nextjs'
import { WorkCard } from './WorkCard'
import { mediaUrl, mediaDownloadUrl, type CompetitionAsset } from '@/lib/media-helpers'

// T4 — work card: preview always open; a gated file opens the email-only gate
// (the full file only ever goes out by email), an open file downloads directly.
// Fixtures are inline: lib/media-manifest is server-only.
const open: CompetitionAsset = {
  id: 'story-open',
  title: 'Previous Design Dossier',
  pages: 3,
  thumbnail: mediaUrl('/files/2026-10/student-work-dossier-2026.cover.jpg'),
  previewHref: mediaUrl('/files/2026-10/student-work-dossier-2026.pdf'),
  gated: false,
  fileHref: mediaDownloadUrl('/files/2026-10/student-work-dossier-2026.pdf'),
  credit: '100% high school student developed material',
}
const gated: CompetitionAsset = {
  id: 'story-gated',
  title: '2026 Space Design Challenge — Mission Handbook',
  pages: null,
  thumbnail: mediaUrl('/files/2026-10/mission-handbook-2026-excerpt.cover.jpg'),
  previewHref: mediaUrl('/files/2026-10/mission-handbook-2026-excerpt.pdf'),
  gated: true,
  assetKey: 'mission-handbook-2026',
  credit: 'Stellr',
}

const meta: Meta<typeof WorkCard> = {
  title: 'Media/WorkCard',
  component: WorkCard,
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof WorkCard>

export const FreeDownload: Story = { args: { asset: open } }
export const GatedDownload: Story = { args: { asset: gated } }
