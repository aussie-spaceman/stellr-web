// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The registration layout sets prefetchUI={false}, so Clerk's prebuilt UI isn't
// loaded there, and an in-app navigation keeps the same Clerk instance. A next/link
// or router call from these pages to a page that renders that UI crashes it with
// "Clerk was not loaded with Ui components", and "Try again" doesn't recover. Seen
// in a browser on 6 Nov 2026 on the sign-in links and the links to /account. Those
// links must be plain <a>, which loads the page afresh.

const ROOTS = ['app/(flow)/register', 'app/%5Ft/[tenant]/(flow)/register', 'components/forms', 'components/registration']

/** Where Clerk's UI renders: its sign-in and sign-up cards, and the member and admin avatars. */
const NEEDS_CLERK_UI =
  /\/(sign-in|sign-up|account|home|community|admin|campaigns|credentials)\b|\b(authPath|signInUrl|signUpUrl|onboardingUrl)\b/

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(path.join(process.cwd(), root), { recursive: true, encoding: 'utf8' })
      .map((rel) => path.posix.join(root, rel.split(path.sep).join('/')))
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel)),
  )
}

function inAppNavigations(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  const report = (node: ts.Node, target: string) => {
    if (!NEEDS_CLERK_UI.test(target)) return
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
    out.push(`${file}:${line + 1} ${target}`)
  }
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'Link') {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.name.getText() === 'href' && attr.initializer) {
          report(node, attr.initializer.getText())
        }
      }
    }
    if (ts.isCallExpression(node) && /^router\.(push|replace)$/.test(node.expression.getText()) && node.arguments[0]) {
      report(node, node.arguments[0].getText())
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('links out of the registration pages', () => {
  it('never navigate in-app to a page that renders Clerk UI', () => {
    const files = sourceFiles()
    expect(files).toContain('components/forms/OnFilePrompt.tsx')
    expect(files.flatMap((file) => inAppNavigations(file, readFileSync(file, 'utf8')))).toEqual([])
  })
})

describe('the check itself', () => {
  const found = (src: string) => inAppNavigations('x.tsx', src)

  it('fires on a Link to sign-in, by path or through a variable or helper', () => {
    expect(found('<Link href="/sign-in">x</Link>')).toHaveLength(1)
    expect(found('<Link href={signInUrl} className="a">x</Link>')).toHaveLength(1)
    expect(found('<Link href={authPath(next)}>x</Link>')).toHaveLength(1)
  })

  it('fires on a Link or router call to a member page', () => {
    expect(found('<Link href="/account?tab=teams">x</Link>')).toHaveLength(1)
    expect(found('<Link href={onboardingUrl} {...newTab}>x</Link>')).toHaveLength(1)
    expect(found("router.push('/account')")).toHaveLength(1)
  })

  it('leaves plain anchors and public pages alone', () => {
    expect(found('<a href={signInUrl}>x</a>')).toEqual([])
    expect(found('<Link href="/events">x</Link>')).toEqual([])
    expect(found('<Link href={`/register/${slug}/confirmation`}>x</Link>')).toEqual([])
    expect(found("router.push(`/register/${slug}/confirmation`)")).toEqual([])
  })
})
