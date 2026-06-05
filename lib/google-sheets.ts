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

const HEADERS = [
  'Membership ID', 'Type', 'First Name', 'Last Name', 'Email', 'Phone',
  'Date of Birth', 'Gender', 'T-Shirt Size', 'Grade',
  'Dietary Requirements', 'Health Conditions',
  'Emergency Contact First Name', 'Emergency Contact Last Name',
  'Emergency Contact Email', 'Emergency Contact Phone',
]

const COL_WIDTHS = [130, 80, 120, 120, 200, 130, 120, 90, 110, 140, 200, 180, 180, 180, 200, 180]

// Column indices (0-based)
const COL_GRADE = 9
const COL_EC_START = 12
const COL_EC_END = 16 // exclusive

const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const GENDERS = ['Male', 'Female', 'Other']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Vegetarian', 'Vegan', 'Other']

const GREY = { red: 0.84, green: 0.84, blue: 0.84 }
const GREY_TEXT = { red: 0.55, green: 0.55, blue: 0.55 }
const HEADER_BG = { red: 0.118, green: 0.227, blue: 0.373 }
const WHITE = { red: 1, green: 1, blue: 1 }
const UNUSED_BG = { red: 0.92, green: 0.92, blue: 0.92 }

export async function createGroupRegistrationSheet({
  eventTitle,
  schoolName,
  teacherEmail,
  additionalAdultCount,
  studentCount,
}: {
  eventTitle: string
  schoolName: string
  teacherEmail: string
  additionalAdultCount: number
  studentCount: number
}): Promise<string> {
  const auth = getAuth()
  if (!auth) throw new Error('Google service account not configured')

  const sheets = google.sheets({ version: 'v4', auth })
  const drive = google.drive({ version: 'v3', auth })

  const totalDataRows = additionalAdultCount + studentCount
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

  // ── Write data rows (placeholder values) ───────────────────────────────────
  if (totalDataRows > 0) {
    const adultRows = Array.from({ length: additionalAdultCount }, () => [
      '<new adult registrant>', 'Adult', '', '', '', '', '', '', '', 'N/A — Adult',
      '', '', 'N/A — Adult', 'N/A — Adult', 'N/A — Adult', 'N/A — Adult',
    ])
    const studentRows = Array.from({ length: studentCount }, () => [
      '<new student registrant>', 'Student', '', '', '', '', '', '', '', '',
      '', '', '', '', '', '',
    ])
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Participants!A2:${colLetter(HEADERS.length)}${1 + totalDataRows}`,
      valueInputOption: 'RAW',
      requestBody: { values: [...adultRows, ...studentRows] },
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

  // Adult rows: grey Grade + Emergency Contact columns
  for (let i = 0; i < additionalAdultCount; i++) {
    const row = 1 + i
    requests.push(repeatCell(sheetId, row, row + 1, COL_GRADE, COL_GRADE + 1, {
      userEnteredFormat: { backgroundColor: GREY, textFormat: { foregroundColor: GREY_TEXT, italic: true } },
      note: 'Not required for adult participants',
    }, 'userEnteredFormat(backgroundColor,textFormat),note'))
    requests.push(repeatCell(sheetId, row, row + 1, COL_EC_START, COL_EC_END, {
      userEnteredFormat: { backgroundColor: GREY, textFormat: { foregroundColor: GREY_TEXT, italic: true } },
      note: 'Not required for adult participants',
    }, 'userEnteredFormat(backgroundColor,textFormat),note'))
  }

  // Unused rows: grey background + protect
  if (1 + totalDataRows < totalRows) {
    requests.push(repeatCell(sheetId, 1 + totalDataRows, totalRows, 0, HEADERS.length, {
      userEnteredFormat: { backgroundColor: UNUSED_BG },
    }, 'userEnteredFormat(backgroundColor)'))
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId, startRowIndex: 1 + totalDataRows, endRowIndex: totalRows },
          description: 'Unused rows',
          warningOnly: false,
          editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
        },
      },
    })
  }

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

  // Protect Membership ID column (col A) — warning only so teacher can see it
  if (totalDataRows > 0) {
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 1 + totalDataRows, startColumnIndex: 0, endColumnIndex: 1 },
          description: 'Membership IDs — assigned by Stellr',
          warningOnly: true,
          editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
        },
      },
    })

    // Protect Type column (col B) — warning only
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 1 + totalDataRows, startColumnIndex: 1, endColumnIndex: 2 },
          description: 'Participant type — do not change',
          warningOnly: true,
          editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
        },
      },
    })
  }

  // Dropdown: Gender (all data rows, col 7)
  if (totalDataRows > 0) {
    requests.push(dataValidation(sheetId, 1, 1 + totalDataRows, 7, 8, GENDERS))
    requests.push(dataValidation(sheetId, 1, 1 + totalDataRows, 8, 9, T_SHIRT_SIZES))
    requests.push(dataValidation(sheetId, 1, 1 + totalDataRows, 10, 11, DIETARY_OPTIONS))
  }

  // Dropdown: Grade — student rows only
  if (studentCount > 0) {
    requests.push(dataValidation(
      sheetId,
      1 + additionalAdultCount, 1 + totalDataRows,
      COL_GRADE, COL_GRADE + 1,
      GRADES,
    ))
  }

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
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: { type: 'user', role: 'writer', emailAddress: teacherEmail },
    sendNotificationEmail: false,
  })

  if (teacherEmail.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { type: 'user', role: 'writer', emailAddress: OWNER_EMAIL },
      sendNotificationEmail: false,
    })
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
