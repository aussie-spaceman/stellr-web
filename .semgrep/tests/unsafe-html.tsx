// Semgrep rule test for .semgrep/unsafe-html.yml. Never imported or compiled:
// .semgrep/ is excluded from tsconfig and from scans (.semgrepignore).
import { createElement } from 'react'

declare const html: string
declare const el: HTMLElement

export function BadDiv() {
  // ruleid: stellr-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

export function BadHandWrittenJsonLd() {
  // ruleid: stellr-dangerously-set-inner-html
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(html) }} />
}

export function BadCreateElement() {
  // ruleid: stellr-dangerously-set-inner-html
  return createElement('div', { dangerouslySetInnerHTML: { __html: html } })
}

export function badDom() {
  // ruleid: stellr-dangerously-set-inner-html
  el.innerHTML = html
  // ruleid: stellr-dangerously-set-inner-html
  el.insertAdjacentHTML('beforeend', html)
}

export function Good() {
  // ok: stellr-dangerously-set-inner-html
  return <div title={html}>{html}</div>
}

export function goodDom() {
  // ok: stellr-dangerously-set-inner-html
  el.textContent = html
}
