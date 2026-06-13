import { google } from 'googleapis'

const OWNER_EMAIL = process.env.GOOGLE_SHEET_OWNER_EMAIL ?? 'david.shaw@insimeducation.com'

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const subject = process.env.GOOGLE_IMPERSONATE_USER ?? OWNER_EMAIL
  if (!email || !key) return null
  return new google.auth.JWT({
    email,
    key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    subject,
  })
}

export function isGoogleSheetsConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

export interface SheetParticipant {
  membership_id: string
  type: string
  first_name: string
  last_name: string
  email: string
  phone: string
  date_of_birth: string
  gender: string
  t_shirt_size: string
  grade: string
  dietary_requirements: string[]
  health_conditions: string
  ec_first_name: string
  ec_last_name: string
  ec_email: string
  ec_phone: string
  ec_relationship: string
}

export async function readSheetParticipants(spreadsheetId: string): Promise<SheetParticipant[]> {
  const auth = getAuth()
  if (!auth) throw new Error('Google service account not configured')

  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Participants!A2:Q',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  const rows = res.data.values ?? []
  return rows
    // Keep any row the teacher has actually filled in (a name or email), not just
    // rows that already carry a Stellr-assigned Membership ID. New rows the
    // teacher adds — including ones still showing the "<new … registrant>"
    // placeholder in the protected Membership ID column — must still sync.
    .filter(row => {
      const firstName = String(row[2] ?? '').trim()
      const email = String(row[4] ?? '').trim()
      return Boolean(firstName || email)
    })
    .map(row => ({
      // The "<new … registrant>" placeholder in col A is not a real id.
      membership_id: String(row[0] ?? '').startsWith('<') ? '' : String(row[0] ?? ''),
      type: String(row[1] ?? ''),
      first_name: String(row[2] ?? ''),
      last_name: String(row[3] ?? ''),
      email: String(row[4] ?? ''),
      phone: String(row[5] ?? ''),
      // DOB may arrive as a Sheets date serial (UNFORMATTED_VALUE), an ISO string,
      // or a US/EU slash date — normalise all to YYYY-MM-DD (see parseSheetDate).
      date_of_birth: parseSheetDate(row[6]) ?? '',
      gender: String(row[7] ?? ''),
      t_shirt_size: String(row[8] ?? ''),
      grade: String(row[9] ?? ''),
      dietary_requirements: row[10] ? String(row[10]).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      health_conditions: String(row[11] ?? ''),
      ec_first_name: String(row[12] ?? ''),
      ec_last_name: String(row[13] ?? ''),
      ec_email: String(row[14] ?? ''),
      ec_phone: String(row[15] ?? ''),
      ec_relationship: String(row[16] ?? ''),
    }))
}

// Normalise a Date-of-Birth cell to ISO (YYYY-MM-DD), accepting:
//   • Google Sheets date serials (UNFORMATTED_VALUE returns dates as numbers)
//   • ISO strings (2008-03-15)
//   • US (MM/DD/YYYY) and European (DD/MM/YYYY) slash/dash/dot dates, 2- or 4-digit year
// Ambiguous all-≤12 raw text dates (e.g. 03/04/2008) can't be disambiguated
// without a locale, so they fall back to US MM/DD. In practice the DOB column is
// date-formatted and displays the month by name (DD-MMM-YYYY), so a misparse is
// visible to the user before they sync.
function parseSheetDate(value: unknown): string | null {
  if (value == null || value === '') return null

  // Sheets/Excel serial: 25569 = 1970-01-01 in the 1899-12-30 date system.
  if (typeof value === 'number' && isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }

  const s = String(value).trim()
  if (!s) return null

  // ISO (unambiguous): YYYY-MM-DD
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) return isoOrNull(+m[1], +m[2], +m[3])

  // D/M/Y or M/D/Y, 2- or 4-digit year
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    const a = +m[1], b = +m[2]
    let y = +m[3]
    if (m[3].length === 2) y += y < 50 ? 2000 : 1900
    let month: number, day: number
    if (a > 12 && b <= 12) { day = a; month = b }        // unambiguously DD/MM
    else if (b > 12 && a <= 12) { month = a; day = b }   // unambiguously MM/DD
    else { month = a; day = b }                          // ambiguous → assume US MM/DD
    return isoOrNull(y, month, day)
  }

  // Last resort: let Date try (e.g. "March 5, 2008")
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function isoOrNull(y: number, mo: number, d: number): string | null {
  if (!y || !mo || !d || mo > 12 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

// ── Watch / push notification helpers ────────────────────────────────────────

export interface WatchChannelResult {
  channel_id: string
  resource_id: string
  expiration: Date
}

export async function watchSheet(spreadsheetId: string, channelId: string): Promise<WatchChannelResult> {
  const auth = getAuth()
  if (!auth) throw new Error('Google service account not configured')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const drive = google.drive({ version: 'v3', auth })

  const expirationMs = Date.now() + 6 * 24 * 60 * 60 * 1000 // 6 days (Google max is 7)

  const res = await drive.files.watch({
    fileId: spreadsheetId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: `${siteUrl}/api/webhooks/google-sheets`,
      expiration: String(expirationMs),
    },
  })

  return {
    channel_id: res.data.id!,
    resource_id: res.data.resourceId!,
    expiration: new Date(Number(res.data.expiration)),
  }
}

export async function stopWatchChannel(channelId: string, resourceId: string): Promise<void> {
  const auth = getAuth()
  if (!auth) return

  const drive = google.drive({ version: 'v3', auth })
  await drive.channels.stop({ requestBody: { id: channelId, resourceId } }).catch(() => {
    // best-effort — channel may have already expired
  })
}

const HEADERS = [
  'Membership ID', 'Type', 'First Name', 'Last Name', 'Email', 'Phone',
  'Date of Birth', 'Gender', 'T-Shirt Size', 'Grade',
  'Dietary Requirements', 'Health Conditions',
  'Emergency Contact First Name', 'Emergency Contact Last Name',
  'Emergency Contact Email', 'Emergency Contact Phone',
  'Emergency Contact Relationship',
]

const COL_WIDTHS = [130, 80, 120, 120, 200, 130, 120, 90, 110, 140, 200, 180, 180, 180, 200, 180, 200]

// Column indices (0-based)
const COL_TYPE = 1
const COL_DOB = 6
const COL_GRADE = 9
const COL_EC_START = 12
const COL_EC_END = 17 // exclusive — includes Relationship (col 16)
const COL_EC_RELATIONSHIP = 16

const PARTICIPANT_TYPES = ['Student', 'Adult', 'Mentor', 'Teacher']
const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const GENDERS = ['Male', 'Female', 'Other']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Vegetarian', 'Vegan', 'Other']
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']

const GREY = { red: 0.84, green: 0.84, blue: 0.84 }
const LIGHT_GREY = { red: 0.95, green: 0.95, blue: 0.95 }
const GREY_TEXT = { red: 0.55, green: 0.55, blue: 0.55 }
const HEADER_BG = { red: 0.118, green: 0.227, blue: 0.373 }
const WHITE = { red: 1, green: 1, blue: 1 }

// A participant already entered on the web form, seeded into the sheet as a
// greyed, read-only row so the organiser sees the full roster in one place. They
// are matched by email on sync (sheet-participant-sync), so re-syncing updates
// the existing participant rather than creating a duplicate.
export interface SheetSeedRow {
  type: 'Student' | 'Adult' | 'Teacher' | 'Mentor'
  first_name: string
  last_name: string
  email: string
  phone: string
  date_of_birth: string          // ISO YYYY-MM-DD (or '')
  gender: string
  t_shirt_size: string
  grade: string
  dietary_requirements: string[]
  health_conditions: string
  ec_first_name: string
  ec_last_name: string
  ec_email: string
  ec_phone: string
  ec_relationship: string
}

export async function createGroupRegistrationSheet({
  eventTitle,
  schoolName,
  teacherEmail,
  additionalAdultCount,
  studentCount,
  enteredParticipants = [],
}: {
  eventTitle: string
  schoolName: string
  teacherEmail: string
  // Blank rows to leave for people still to be entered (the REMAINDER, after any
  // already added on the web form). For a non-partial registration these equal the
  // whole roster; for a partial add_now they're the leftover slots only.
  additionalAdultCount: number
  studentCount: number
  // Already-entered people, pre-filled + greyed at the top of the sheet.
  enteredParticipants?: SheetSeedRow[]
}): Promise<{ spreadsheetId: string; url: string }> {
  const auth = getAuth()
  if (!auth) throw new Error('Google service account not configured')

  const sheets = google.sheets({ version: 'v4', auth })
  const drive = google.drive({ version: 'v3', auth })

  const enteredCount = enteredParticipants.length
  const blankDataRows = additionalAdultCount + studentCount
  const totalDataRows = enteredCount + blankDataRows
  const totalRows = 1 + totalDataRows + 50 // header + data + buffer

  // ── Create spreadsheet ──────────────────────────────────────────────────────
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${eventTitle} — ${schoolName} — Group Registration` },
      sheets: [{
        properties: {
          title: 'Participants',
          gridProperties: { rowCount: totalRows, columnCount: HEADERS.length, frozenRowCount: 1 },
        },
      }],
    },
  })

  const spreadsheetId = created.data.spreadsheetId!
  const sheetId = created.data.sheets![0].properties!.sheetId!

  // ── Write header row ────────────────────────────────────────────────────────
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Participants!A1:${colLetter(HEADERS.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  })

  // ── Write data rows ─────────────────────────────────────────────────────────
  // Entered people (already on the web form) come first as pre-filled rows, then
  // blank placeholder rows for the people still to be added. Membership ID (col A)
  // is left blank on entered rows — sync matches them back by email, so they update
  // their existing participant instead of duplicating. DOB is written as a Sheets
  // date serial so the dd-mmm-yyyy column format applies and parseSheetDate reads
  // it back; everything else stays text (RAW) so phone numbers keep leading zeros.
  if (totalDataRows > 0) {
    const enteredRows = enteredParticipants.map(p => [
      '',                                                  // Membership ID (blank — matched by email)
      p.type,
      p.first_name, p.last_name, p.email, p.phone,
      p.date_of_birth ? isoToSheetSerial(p.date_of_birth) : '',
      p.gender, p.t_shirt_size,
      p.type === 'Student' ? p.grade : '',                 // Grade — blank/greyed for non-students
      (p.dietary_requirements ?? []).join(', '),
      p.health_conditions ?? '',
      p.ec_first_name ?? '', p.ec_last_name ?? '', p.ec_email ?? '', p.ec_phone ?? '', p.ec_relationship ?? '',
    ])
    const adultRows = Array.from({ length: additionalAdultCount }, () => [
      '<new adult registrant>', 'Adult', '', '', '', '', '', '', '', 'N/A — Adult',
      '', '', 'N/A — Adult', 'N/A — Adult', 'N/A — Adult', 'N/A — Adult', 'N/A — Adult',
    ])
    const studentRows = Array.from({ length: studentCount }, () => [
      '<new student registrant>', 'Student', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '',
    ])
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Participants!A2:${colLetter(HEADERS.length)}${1 + totalDataRows}`,
      valueInputOption: 'RAW',
      requestBody: { values: [...enteredRows, ...adultRows, ...studentRows] },
    })
  }

  // ── Batch formatting ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = []

  // Header row style
  requests.push(repeatCell(sheetId, 0, 1, 0, HEADERS.length, {
    userEnteredFormat: {
      backgroundColor: HEADER_BG,
      textFormat: { foregroundColor: WHITE, bold: true, fontSize: 10 },
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE',
    },
  }, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)'))

  // Grey out Grade + Emergency Contact for any NON-student row, driven by the
  // Type column so it follows the dropdown (a static per-row grey only covered
  // the pre-filled adult rows and didn't react when Type changed, or to mentors
  // / teachers). Grade + emergency contact are required for students only.
  //
  // Each range gets its OWN rule: a single CUSTOM_FORMULA rule spanning two
  // disjoint ranges doesn't anchor the relative $B2 reference per-row reliably
  // (one row's Type ended up greying the whole column, so a single Teacher/Adult
  // row greyed every row). One range per rule anchors $B2 to that range's own
  // row 2 and advances correctly per row.
  const greyNotStudentRule = (startCol: number, endCol: number) => ({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: totalRows, startColumnIndex: startCol, endColumnIndex: endCol }],
        booleanRule: {
          // $B locks to the Type column; row is relative to row 2 (range start).
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($B2<>"",$B2<>"Student")' }] },
          format: { backgroundColor: GREY, textFormat: { foregroundColor: GREY_TEXT, italic: true } },
        },
      },
    },
  })
  requests.push(greyNotStudentRule(COL_GRADE, COL_GRADE + 1))
  requests.push(greyNotStudentRule(COL_EC_START, COL_EC_END))

  // ── Already-entered rows: light grey + read-only ──────────────────────────────
  // People added on the web form are pre-filled at the top. Tint them and protect
  // the block (warning-only, so the organiser CAN override if they must) to signal
  // "already registered — edit on Stellr, not here". Sync still matches them by
  // email, so even an edited row updates the existing participant, never duplicates.
  if (enteredCount > 0) {
    requests.push(repeatCell(sheetId, 1, 1 + enteredCount, 0, HEADERS.length, {
      userEnteredFormat: { backgroundColor: LIGHT_GREY, textFormat: { foregroundColor: GREY_TEXT } },
    }, 'userEnteredFormat(backgroundColor,textFormat)'))
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 1 + enteredCount },
          description: 'Already added via the web form — these participants are registered. Edit them on Stellr, not here.',
          warningOnly: true,
          editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
        },
      },
    })
  }

  // Buffer rows are left open (no lock) so the teacher can add more participants
  // than the initial count — every row below carries the same dropdowns, so they
  // never have to copy/paste formatting from a line above.

  // Protect header row
  requests.push({
    addProtectedRange: {
      protectedRange: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        description: 'Header row — do not edit',
        warningOnly: false,
        editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
      },
    },
  })

  // Protect Membership ID column (col A) across the whole sheet — warning only,
  // so the teacher can still type an existing Stellr Member ID into a new row.
  requests.push({
    addProtectedRange: {
      protectedRange: {
        range: { sheetId, startRowIndex: 1, endRowIndex: totalRows, startColumnIndex: 0, endColumnIndex: 1 },
        description: 'Membership IDs — assigned by Stellr (leave blank for new people)',
        warningOnly: true,
        editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
      },
    },
  })

  // Dropdowns on EVERY row (header+1 → end), so pre-filled and buffer rows alike
  // offer the right options. strict:false keeps the adult "N/A — Adult" notes and
  // free-typed dietary lists valid. The Type column is a dropdown now (not free
  // text) and is left editable so teachers can set it on rows they add.
  const lastRow = totalRows
  requests.push(dataValidation(sheetId, 1, lastRow, COL_TYPE, COL_TYPE + 1, PARTICIPANT_TYPES))
  requests.push(dataValidation(sheetId, 1, lastRow, 7, 8, GENDERS))
  requests.push(dataValidation(sheetId, 1, lastRow, 8, 9, T_SHIRT_SIZES))
  requests.push(dataValidation(sheetId, 1, lastRow, 10, 11, DIETARY_OPTIONS))
  requests.push(dataValidation(sheetId, 1, lastRow, COL_GRADE, COL_GRADE + 1, GRADES))
  requests.push(dataValidation(sheetId, 1, lastRow, COL_EC_RELATIONSHIP, COL_EC_RELATIONSHIP + 1, EMERGENCY_RELATIONSHIPS))

  // Date of Birth: display the month as a NAME (DD-MMM-YYYY, e.g. 10-Apr-2016) so
  // a date is unambiguous regardless of US (MM/DD) vs European (DD/MM) entry — the
  // user sees the month spelt out and can immediately spot a misparse. The reader
  // (parseSheetDate) works off the underlying serial, so the display is cosmetic.
  requests.push(repeatCell(sheetId, 1, lastRow, COL_DOB, COL_DOB + 1, {
    userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd-mmm-yyyy' } },
  }, 'userEnteredFormat.numberFormat'))
  requests.push({
    updateCells: {
      rows: [{ values: [{ note: 'Dates display as DD-MMM-YYYY (e.g. 10-Apr-2016) — the month is spelt out so US and European entries can’t be confused.' }] }],
      fields: 'note',
      start: { sheetId, rowIndex: 0, columnIndex: COL_DOB },
    },
  })

  // Column widths
  COL_WIDTHS.forEach((width, idx) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
        properties: { pixelSize: width },
        fields: 'pixelSize',
      },
    })
  })

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })

  // ── Share ───────────────────────────────────────────────────────────────────
  // Anyone with the link can edit: the registrant opens it immediately without a
  // Google sign-in. App-level gating (the authenticated, ownership-checked sheet
  // endpoint) controls who can obtain the link in the first place.
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'anyone', role: 'writer' },
  })

  // Keep the owner as an explicit editor so it stays in their Drive.
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: OWNER_EMAIL },
    sendNotificationEmail: false,
  })

  return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ISO date (YYYY-MM-DD) → Google Sheets serial (days since 1899-12-30), so a
// pre-filled DOB renders under the dd-mmm-yyyy column format and reads back via
// parseSheetDate's serial branch. Returns '' for an unparseable/empty date.
function isoToSheetSerial(iso: string): number | string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const epoch = Date.UTC(1899, 11, 30)
  const serial = Math.round((utc - epoch) / 86400000)
  return Number.isFinite(serial) ? serial : ''
}

function colLetter(n: number): string {
  // 1-indexed column number to letter (A, B, ..., Z, AA, ...)
  let result = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

function repeatCell(
  sheetId: number,
  startRow: number, endRow: number,
  startCol: number, endCol: number,
  cell: object,
  fields: string,
) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      cell,
      fields,
    },
  }
}

function dataValidation(
  sheetId: number,
  startRow: number, endRow: number,
  startCol: number, endCol: number,
  values: string[],
) {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: values.map(v => ({ userEnteredValue: v })),
        },
        showCustomUi: true,
        strict: false,
      },
    },
  }
}
