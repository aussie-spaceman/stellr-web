import type { Meta, StoryObj } from '@storybook/nextjs'
import { usePathname } from '@storybook/nextjs/navigation.mock'
import { AppSidebar } from './AppSidebar'

/**
 * The member app's navigation. Below lg it is the bottom tab bar, with "More"
 * opening a sheet of every section; from lg it is the dark rail.
 *
 * usePathname is mocked to a fixed value: the real one needs Next's request
 * store, which Storybook 10.4 doesn't provide under Next 16.
 */
const meta: Meta<typeof AppSidebar> = {
  title: 'Chrome/AppSidebar',
  component: AppSidebar,
  beforeEach() {
    usePathname.mockReturnValue('/community/mentoring')
  },
  render: (args) => (
    <div className="flex min-h-[600px] bg-surface">
      <AppSidebar {...args} />
      <main className="flex-1 p-6 text-sm text-content-body">Page content</main>
    </div>
  ),
}
export default meta

export const Member: StoryObj<typeof AppSidebar> = { args: { canHost: false, isTeacher: false } }
export const TeacherWhoHosts: StoryObj<typeof AppSidebar> = { args: { canHost: true, isTeacher: true } }
