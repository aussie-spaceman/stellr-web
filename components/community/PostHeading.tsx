// Post-detail heading. Titles are optional on feed posts (F-03), so a blank
// title renders nothing — never an empty <h1>.
export function PostHeading({ title }: { title: string | null }) {
  const t = title?.trim()
  if (!t) return null
  return <h1 className="text-xl font-bold text-brand-blue-dark">{t}</h1>
}
