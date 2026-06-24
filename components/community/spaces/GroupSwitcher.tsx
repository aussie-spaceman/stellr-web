'use client'

import { useRouter } from 'next/navigation'

// "Switch group" control on the teacher Group spaces view (screen 09). Navigates
// to ?group=<id>; the server re-renders the access table for the chosen group.
export function GroupSwitcher({
  groups,
  current,
}: {
  groups: { id: string; name: string }[]
  current: string
}) {
  const router = useRouter()
  if (groups.length < 2) return null
  return (
    <label className="flex items-center gap-2 text-xs text-brand-muted-soft">
      Switch group
      <select
        value={current}
        onChange={(e) => router.push(`/community/teacher/group-spaces?group=${e.target.value}`)}
        className="rounded-lg border border-brand-border bg-white px-2 py-1 text-sm text-brand-blue-dark focus:border-brand-blue focus:outline-none"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  )
}
