// CSV building for admin downloads (event roster, member list).
//
// Cells hold text typed by the public: names, phone numbers, health notes,
// emergency contacts. Excel and Google Sheets read a cell starting with
// = + - @ (or tab / carriage return) as a formula, so "=HYPERLINK(...)" in a
// name would run when an organiser opens the file, and "+1 555 0100" becomes
// #NAME?. Such cells are prefixed with an apostrophe (OWASP's CSV injection
// guidance): the value is then text in every spreadsheet, at the cost of a
// visible leading ' in plain-text viewers.

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value == null ? '' : String(value)
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}
