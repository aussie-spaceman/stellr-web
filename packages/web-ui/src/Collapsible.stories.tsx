import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Collapsible, CollapsibleGroup, CollapseAllControls } from './Collapsible'

const meta: Meta = { title: 'Primitives/Collapsible' }
export default meta

export const Sections: StoryObj = {
  render: () => (
    <div className="max-w-content space-y-3 p-8">
      <CollapsibleGroup storageKey="storybook.sections">
        <CollapseAllControls className="justify-end" />
        <Collapsible
          id="team"
          title="Team profiles"
          summary="18 submitted · 4 not sent"
          description="Team profiles go out once a permission form is complete."
        >
          <p className="text-sm text-content-body">Table of students and their answers.</p>
        </Collapsible>
        <Collapsible
          id="group-a"
          tone="primary"
          headingLevel={3}
          defaultOpen={false}
          title="Group: Lincoln High (Teacher)"
          summary="12 students · 3 unpaid · 2 DocuSign open"
          actions={<button className="text-xs font-medium text-primary">Add participant</button>}
          bodyClassName="p-0"
        >
          <p className="p-4 text-sm text-content-body">The group&apos;s roster table.</p>
        </Collapsible>
        <Collapsible
          id="indiv"
          tone="muted"
          headingLevel={3}
          defaultOpen={false}
          title="Individual registration"
          summary="1 student · all clear"
        >
          <p className="text-sm text-content-body">One participant.</p>
        </Collapsible>
      </CollapsibleGroup>
    </div>
  ),
}
