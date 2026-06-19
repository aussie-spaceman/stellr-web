// @stellr/web-ui CtaBand — the navy call-to-action card that closes a page.
import * as React from 'react'

export function CtaBand({
  title,
  body,
  actions,
}: {
  title: React.ReactNode
  body?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="section-padding bg-white pt-0">
      <div className="container-max">
        <div className="bg-midnight rounded-panel px-10 py-12 text-white flex flex-wrap items-center justify-between gap-8">
          <div>
            <h2 className="text-3xl font-bold mb-2">{title}</h2>
            {body && <p className="text-hero-lead max-w-md leading-relaxed">{body}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
        </div>
      </div>
    </section>
  )
}
