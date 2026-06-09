import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isGoogleSheetsConfigured } from '@/lib/google-sheets'
import { google } from 'googleapis'

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

const OWNER_EMAIL = process.env.GOOGLE_SHEET_OWNER_EMAIL ?? 'david.shaw@insimeducation.com'

const HEADERS = [
  'Membership ID', 'Type', 'First Name', 'Last Name', 'Email', 'Phone',
  'Date of Birth', 'Gender', 'T-Shirt Size', 'Grade',
  'Dietary Requirements', 'Health Conditions',
  'Emergency Contact First Name', 'Emergency Contact Last Name',
  'Emergency Contact Email', 'Emergency Contact Phone',
]

const GENDERS = ['Male', 'Female', 'Other']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Vegetarian', 'Vegan', 'Other']

function dropdown(sheetId: number, startRow: number, endRow: number, col: number, values: string[]) {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: col, endColumnIndex: col + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map(v => ({ userEnteredValue: v })) },
        showCustomUi: true,
        strict: false,
      },
    },
  }
}

function greyCell(sheetId: number, rowIndex: number, startCol: number, endCol: number, note: string) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.84, green: 0.84, blue: 0.84 },
          textFormat: { foregroundColor: { red: 0.55, green: 0.55, blue: 0.55 }, italic: true },
        },
        note,
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat),note',
    },
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isGoogleSheetsConfigured()) {
      console.error('[spreadsheet] Google Sheets env vars not configured')
      return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 503 })
    }

    const db = supabaseServer()

    const { data: registration, error: regErr } = await db
      .from('registrations')
      .select('id, event_title, school_name, teacher_email, type, spreadsheet_id')
      .eq('id', id)
      .maybeSingle()

    if (regErr) {
      console.error('[spreadsheet] DB error:', regErr)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    if (!registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }

    const reg = registration as {
      id: string; event_title: string; school_name: string | null
      teacher_email: string | null; type: string; spreadsheet_id: string | null
    }

    if (reg.type !== 'group') {
      return NextResponse.json({ error: 'Only available for group registrations' }, { status: 400 })
    }

    // Return existing sheet URL rather than creating a new one each time
    if (reg.spreadsheet_id) {
      const existingUrl = `https://docs.google.com/spreadsheets/d/${reg.spreadsheet_id}/edit`
      return NextResponse.redirect(existingUrl, { status: 302 })
    }

    const { data: participants, error: partErr } = await db
      .from('participants')
      .select('membership_id, event_role, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, grade, dietary_requirements, health_conditions, emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email, emergency_contact_phone')
      .eq('registration_id', id)
      .order('event_role')

    if (partErr) {
      console.error('[spreadsheet] Participants DB error:', partErr)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    const rows = (participants ?? []).map((p: Record<string, unknown>) => {
      const dietary = Array.isArray(p.dietary_requirements) ? (p.dietary_requirements as string[]).join(', ') : ''
      return [
        p.membership_id ?? '', p.event_role ?? '',
        p.first_name ?? '', p.last_name ?? '',
        p.email ?? '', p.phone ?? '',
        p.date_of_birth ?? '', p.gender ?? '', p.t_shirt_size ?? '',
        p.grade ?? '', dietary, p.health_conditions ?? '',
        p.emergency_contact_first_name ?? '', p.emergency_contact_last_name ?? '',
        p.emergency_contact_email ?? '', p.emergency_contact_phone ?? '',
      ]
    })

    // Build and return Google Sheet
    const auth = getAuth()
    if (!auth) {
      console.error('[spreadsheet] getAuth() returned null despite isGoogleSheetsConfigured() passing')
      return NextResponse.json({ error: 'Google auth configuration error' }, { status: 503 })
    }
    const sheets = google.sheets({ version: 'v4', auth })
    const drive = google.drive({ version: 'v3', auth })

    const title = `${reg.event_title} — ${reg.school_name ?? 'Group'} Participants`

    console.log('[spreadsheet] Creating sheet:', title)
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [{
          properties: {
            title: 'Participants',
            gridProperties: { rowCount: 1 + rows.length + 20, columnCount: HEADERS.length, frozenRowCount: 1 },
          },
        }],
      },
    })

    const spreadsheetId = created.data.spreadsheetId!
    const sheetId = created.data.sheets![0].properties!.sheetId!

    // Write data
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `Participants!A1:${colLetter(HEADERS.length)}1`, values: [HEADERS] },
          ...(rows.length > 0 ? [{
            range: `Participants!A2:${colLetter(HEADERS.length)}${1 + rows.length}`,
            values: rows,
          }] : []),
        ],
      },
    })

    // Format, protect header, add dropdowns
    const dataRows = rows.length
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Header styling
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.118, green: 0.227, blue: 0.373 },
                  textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
          // Lock header row
          {
            addProtectedRange: {
              protectedRange: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                description: 'Header row — do not edit',
                warningOnly: false,
                editors: { users: [process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, OWNER_EMAIL] },
              },
            },
          },
          // Column widths
          ...([130, 80, 120, 120, 200, 130, 120, 90, 110, 140, 200, 180, 180, 180, 200, 180].map((w, i) => ({
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
              properties: { pixelSize: w },
              fields: 'pixelSize',
            },
          }))),
          // Dropdowns for data rows
          ...(dataRows > 0 ? [
            dropdown(sheetId, 1, 1 + dataRows, 7, GENDERS),         // Gender
            dropdown(sheetId, 1, 1 + dataRows, 8, T_SHIRT_SIZES),   // T-Shirt Size
            dropdown(sheetId, 1, 1 + dataRows, 9, GRADES),          // Grade
            dropdown(sheetId, 1, 1 + dataRows, 10, DIETARY_OPTIONS), // Dietary Requirements
          ] : []),
          // Grey out cells not applicable to Teachers / Adults
          // Grade (col 9) and Emergency Contacts (cols 12-15) are student-only
          ...(participants ?? []).flatMap((p: Record<string, unknown>, i: number) => {
            const role = String(p.event_role ?? '').toLowerCase()
            if (role === 'student') return []
            const rowIndex = 1 + i
            return [
              greyCell(sheetId, rowIndex, 9,  10, 'Not required for non-student participants'),  // Grade
              greyCell(sheetId, rowIndex, 12, 16, 'Not required for non-student participants'),  // EC cols
            ]
          }),
        ],
      },
    })

    // Share with teacher and owner
    if (reg.teacher_email) {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: reg.teacher_email },
        sendNotificationEmail: false,
      })
    }
    if (!reg.teacher_email || reg.teacher_email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { type: 'user', role: 'writer', emailAddress: OWNER_EMAIL },
        sendNotificationEmail: false,
      })
    }

    // Persist the spreadsheet_id so future visits reuse this sheet
    await db.from('registrations').update({ spreadsheet_id: spreadsheetId }).eq('id', id)

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    return NextResponse.redirect(url, { status: 302 })
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cause = (err as any)?.cause
    console.error('[spreadsheet] Unhandled error:', JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      cause: cause ? { message: cause.message, code: cause.code, status: cause.status, errors: cause.errors } : undefined,
    }, null, 2))
    return NextResponse.json(
      { error: 'Failed to generate spreadsheet', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

function colLetter(n: number): string {
  let result = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}
