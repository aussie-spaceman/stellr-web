/**
 * check-migration-transaction.mjs — refuse a migration that ends, or nests,
 * the transaction the Production migration Action runs it in.
 *
 *   node scripts/check-migration-transaction.mjs supabase/migrations/<file>.sql [...]
 *
 * Used by .github/workflows/prod-migrate.yml (check job). The Action runs the
 * file, its ledger row and supabase/tests/security_checks.sql in ONE
 * transaction (psql --single-transaction), so a security-check failure rolls
 * the migration back. A top-level COMMIT in the file would commit everything
 * before it and leave the rest in autocommit, and nothing would roll back.
 *
 * A line grep cannot judge this: `END;` is COMMIT's synonym, `ABORT;` is
 * ROLLBACK's, a COMMIT can sit mid-line after another statement, and
 * `commit work;` / `COMMIT AND CHAIN;` are valid. A grep for those words would
 * also refuse every PL/pgSQL `END;` inside a function body. So this script
 * splits the file into top-level statements the way psql does (skipping
 * comments, quoted strings, quoted identifiers and dollar-quoted bodies, and
 * keeping a CREATE FUNCTION … BEGIN ATOMIC … END body as one statement) and
 * looks at each statement's first word.
 *
 * Refused as a statement's first word(s): BEGIN, START TRANSACTION, COMMIT,
 * END, ROLLBACK, ABORT, SAVEPOINT, RELEASE, PREPARE TRANSACTION.
 * (COMMIT PREPARED / ROLLBACK PREPARED are covered by COMMIT / ROLLBACK.)
 *
 * PL/pgSQL COMMIT inside a DO block or a procedure is not top-level, and needs
 * no check here: Postgres refuses it inside a transaction block ("invalid
 * transaction termination"), so it fails and rolls back. The Action also
 * checks at run time that the transaction id has not changed after the file
 * ran (defence in depth).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TX_FIRST = new Set(['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE'])
const TX_WITH_TRANSACTION = new Set(['START', 'PREPARE'])

const isIdentStart = (c) => /[A-Za-z_\u0080-￿]/.test(c)
const isIdentChar = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c)

/**
 * Split SQL into top-level statements as psql would send them.
 * Returns [{ line, words }] where `words` are the statement's unquoted words,
 * upper-cased, in order (quoted identifiers appear as '"', strings are skipped).
 */
export function splitStatements(sql) {
  const statements = []
  let words = []
  let startLine = 0
  let line = 1
  let beginDepth = 0 // CREATE FUNCTION/PROCEDURE … BEGIN ATOMIC … END
  let i = 0
  const n = sql.length

  const pushWord = (w) => {
    if (words.length === 0) startLine = line
    words.push(w)
    // psql's rule (psqlscan.l): inside CREATE [OR REPLACE] FUNCTION|PROCEDURE,
    // BEGIN and CASE open a block and END closes one; a ';' inside a block
    // does not end the statement.
    const routine =
      words[0] === 'CREATE' &&
      (words[1] === 'FUNCTION' ||
        words[1] === 'PROCEDURE' ||
        (words[1] === 'OR' && words[2] === 'REPLACE' && (words[3] === 'FUNCTION' || words[3] === 'PROCEDURE')))
    if (!routine) return
    if ((w === 'BEGIN' || w === 'CASE') && words.length > 2) beginDepth++
    else if (w === 'END' && beginDepth > 0) beginDepth--
  }
  const countLines = (from, to) => {
    for (let k = from; k < to; k++) if (sql[k] === '\n') line++
  }
  const endStatement = () => {
    if (words.length) statements.push({ line: startLine, words })
    words = []
    beginDepth = 0
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '\n') { line++; i++; continue }
    if (/\s/.test(c)) { i++; continue }

    // -- line comment
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    // /* block comment */, nestable in Postgres
    if (c === '/' && next === '*') {
      let depth = 1
      let k = i + 2
      while (k < n && depth > 0) {
        if (sql[k] === '/' && sql[k + 1] === '*') { depth++; k += 2 }
        else if (sql[k] === '*' && sql[k + 1] === '/') { depth--; k += 2 }
        else k++
      }
      countLines(i, k)
      i = k
      continue
    }
    // 'string', E'string' (backslash escapes), U&'string'; '' is a quote
    if (c === "'") {
      const prev = sql[i - 1]
      const escapes = (prev === 'E' || prev === 'e') && !isIdentChar(sql[i - 2] ?? ' ')
      let k = i + 1
      while (k < n) {
        if (escapes && sql[k] === '\\') { k += 2; continue }
        if (sql[k] === "'") {
          if (sql[k + 1] === "'") { k += 2; continue }
          break
        }
        k++
      }
      countLines(i, k + 1)
      i = k + 1
      if (words.length === 0) startLine = line
      continue
    }
    // "quoted identifier"; "" is a quote
    if (c === '"') {
      let k = i + 1
      while (k < n) {
        if (sql[k] === '"') {
          if (sql[k + 1] === '"') { k += 2; continue }
          break
        }
        k++
      }
      pushWord('"')
      countLines(i, k + 1)
      i = k + 1
      continue
    }
    // $tag$ dollar-quoted body $tag$ (not $1 parameters, not foo$bar)
    if (c === '$' && !isIdentChar(sql[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i, i + 80))
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        const end = close < 0 ? n : close + tag.length
        countLines(i, end)
        i = end
        if (words.length === 0) startLine = line
        continue
      }
    }
    if (c === ';') {
      if (beginDepth === 0) endStatement()
      i++
      continue
    }
    if (isIdentStart(c)) {
      let k = i + 1
      while (k < n && isIdentChar(sql[k])) k++
      pushWord(sql.slice(i, k).toUpperCase())
      i = k
      continue
    }
    // Anything else (operators, digits, punctuation) ends no statement; a
    // statement that starts with one, e.g. "(SELECT 1)", is not transaction
    // control, so record it as a word that matches nothing.
    if (words.length === 0) pushWord(c)
    i++
  }
  endStatement()
  return statements
}

/** Top-level transaction-control statements in `sql`: [{ line, statement }]. */
export function findTransactionControl(sql) {
  const found = []
  for (const { line, words } of splitStatements(sql)) {
    const [first, second] = words
    if (TX_FIRST.has(first) || (TX_WITH_TRANSACTION.has(first) && second === 'TRANSACTION')) {
      found.push({ line, statement: words.slice(0, 3).join(' ') })
    }
  }
  return found
}

function main(files) {
  if (files.length === 0) {
    console.error('usage: node scripts/check-migration-transaction.mjs <migration.sql> [...]')
    process.exit(2)
  }
  let bad = 0
  for (const file of files) {
    for (const { line, statement } of findTransactionControl(readFileSync(file, 'utf8'))) {
      console.error(`${file}:${line}: top-level transaction control (${statement})`)
      bad++
    }
  }
  if (bad) {
    console.error(
      `${bad} transaction-control statement(s). The Production migration Action runs the file in one ` +
        'transaction with its ledger row and the security check; remove them, or apply the file by hand with the owner.',
    )
    process.exit(1)
  }
  console.log(`No top-level transaction control in ${files.length} file(s).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2))
