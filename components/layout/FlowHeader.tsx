import { Logo } from './Logo'

/**
 * Header for single-task pages: check-in, signing, surveys, team profiles and
 * registration. The brand stays, the marketing navigation goes, and it scrolls
 * away with the page, so on a phone the form has the screen to itself.
 */
export function FlowHeader() {
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex h-14 max-w-chrome items-center px-4 sm:px-6">
        <Logo sizeClassName="h-8" displayWidth={97} />
      </div>
    </header>
  )
}
