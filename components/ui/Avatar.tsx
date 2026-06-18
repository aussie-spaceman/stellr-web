// Use anywhere a member appears. Photo if available, else stable colored initials.
// Server-safe (no client hooks). (T1.4)
// Members currently have no photo column, so `src` is normally omitted and
// initials render — the colour is a stable hash of the member id.

const PALETTE = ['#0d439d', '#da6220', '#dda33b', '#1d5fd6', '#051535']

function hashIndex(seed: string, mod: number) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % mod
}

const SIZES = { sm: 24, md: 36, lg: 48 } as const

export function Avatar({
  name,
  id,
  src,
  size = 'md',
  ring = true,
  color,
}: {
  name: string
  id: string // member id — stable colour
  src?: string | null
  size?: keyof typeof SIZES
  ring?: boolean
  /** Override the hashed colour (e.g. orange for mentors). */
  color?: string
}) {
  const px = SIZES[size]
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  const bg = color ?? PALETTE[hashIndex(id || name, PALETTE.length)]
  const fg = bg === '#dda33b' ? '#051535' : '#ffffff'
  const ringClass = ring ? 'ring-2 ring-white' : ''

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        className={`rounded-full object-cover ${ringClass}`}
        style={{ width: px, height: px }}
      />
    )
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-subheading font-semibold ${ringClass}`}
      style={{ width: px, height: px, background: bg, color: fg, fontSize: px * 0.36 }}
      aria-label={name}
    >
      {initials}
    </span>
  )
}

export function AvatarStack({
  people,
  extra,
  label = 'members',
}: {
  people: { id: string; name: string; src?: string | null }[]
  extra?: number
  label?: string
}) {
  return (
    <div className="flex items-center">
      <div className="flex">
        {people.map((p, i) => (
          <div key={p.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
            <Avatar id={p.id} name={p.name} src={p.src} size="sm" />
          </div>
        ))}
      </div>
      {!!extra && extra > 0 && (
        <span className="ml-2 text-[11.5px] text-brand-muted-soft">
          +{extra} {label}
        </span>
      )}
    </div>
  )
}
