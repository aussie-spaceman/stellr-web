import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Walks the repo's own import graph, for tests that hold a file or tree away from
// a module. A dynamic import counts as much as a static one: the bundler still
// pulls the module in. A type-only import is erased, so it doesn't.

const ROOT = process.cwd()
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx']

function resolveLocal(fromFile: string, spec: string, exists: (rel: string) => boolean): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(fromFile), spec)
  else return null
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`
    if (path.posix.extname(candidate) && exists(candidate)) return candidate
  }
  return null
}

/** The module specifiers a file really loads at runtime. */
export function runtimeImports(fileName: string, src: string): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Every repo file reachable from the entry, the entry included. */
export function importClosure(entry: string, read: (rel: string) => string | null): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    const src = read(file)
    if (src === null) continue
    seen.add(file)
    for (const spec of runtimeImports(file, src)) {
      const next = resolveLocal(file, spec, (rel) => read(rel) !== null)
      if (next) queue.push(next)
    }
  }
  return seen
}

export const readRepoFile = (rel: string): string | null => {
  const full = path.join(ROOT, rel)
  return existsSync(full) && /\.(tsx?|mts|m?js)$/.test(rel) ? readFileSync(full, 'utf8') : null
}
