// reference_components/Avatar.tsx
// Use anywhere a member appears. Photo if available, else stable colored initials.
// Server-safe. (T1.4)

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
}: {
  name: string
  id: string // member id — stable color
  src?: string | null
  size?: keyof typeof SIZES
}) {
  const px = SIZES[size]
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const bg = PALETTE[hashIndex(id, PALETTE.length)]
  const fg = bg === '#dda33b' ? '#051535' : '#ffffff'

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        className="rounded-full object-cover ring-2 ring-white"
        style={{ width: px, height: px }}
      />
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold ring-2 ring-white"
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
}: {
  people: { id: string; name: string; src?: string | null }[]
  extra?: number
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
        <span className="ml-2 text-[11.5px] text-brand-muted-soft">+{extra} members</span>
      )}
    </div>
  )
}
