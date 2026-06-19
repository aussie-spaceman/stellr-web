// @stellr/icons — the Stellr line set. 24px grid, 1.8px stroke, rounded joins,
// single colour via `currentColor` (drive with a `text-*` token utility).
// Reproduced verbatim from the Design System handoff iconography.
import * as React from 'react'

export type IconProps = Omit<React.SVGProps<SVGSVGElement>, 'children'> & { size?: number }

function Svg({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const Launch = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c2.5 2 3.5 5 3.5 8.5L14 16h-4l-1.5-4.5C8.5 8 9.5 5 12 3Z" />
    <circle cx="12" cy="9" r="1.3" />
    <path d="M9 16c-1.5.5-2 2-2 4 1.5-.3 2.5-1 3-2M15 16c1.5.5 2 2 2 4-1.5-.3-2.5-1-3-2" />
  </Svg>
)
export const Orbit = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.4" />
    <path d="M5.5 8C3 9.3 2.4 11 3.6 12.4c1.8 2 7 1.3 11.4-1.6S21.4 4.6 20 3.4c-1.2-1-3.3-.6-5.6.8" />
  </Svg>
)
export const Satellite = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20a9 9 0 0 1 9-9" />
    <path d="M4 15a5 5 0 0 1 5 5" />
    <circle cx="4.5" cy="19.5" r="1" />
    <path d="M13 8l3.5-3.5M16 11l3.5-3.5" />
  </Svg>
)
export const Telescope = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16l11-6 1.8 3-11 6z" />
    <path d="M14.5 8.5l3-1.6 1.6 3-3 1.6z" />
    <path d="M9 17l1.8 4M13 15l1.8 4" />
  </Svg>
)
export const Idea = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 18h5M10.5 21h3" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
  </Svg>
)
export const Team = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3" />
    <path d="M3 19a6 6 0 0 1 12 0" />
    <path d="M16 7a3 3 0 0 1 0 6M21 19a6 6 0 0 0-4-5.7" />
  </Svg>
)
export const Award = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4h8v4a4 4 0 0 1-8 0Z" />
    <path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3" />
    <path d="M10 14h4M9 20h6M12 14v6" />
  </Svg>
)
export const Certificate = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="11" rx="2" />
    <path d="M8 9h8M8 12h5" />
    <circle cx="12" cy="18" r="2" />
    <path d="M10.6 19.4 10 22l2-1 2 1-.6-2.6" />
  </Svg>
)
export const Event = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 9h16M9 3v4M15 3v4" />
  </Svg>
)
export const Document = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Svg>
)
export const Global = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </Svg>
)
export const Environment = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20c0-8 6-14 16-15-1 10-7 16-16 15Z" />
    <path d="M9 15c2-3 5-5 8-6" />
  </Svg>
)

export const icons = {
  Launch, Orbit, Satellite, Telescope, Idea, Team,
  Award, Certificate, Event, Document, Global, Environment,
} as const
export type IconName = keyof typeof icons
