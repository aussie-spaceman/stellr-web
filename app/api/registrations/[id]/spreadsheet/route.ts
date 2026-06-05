import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isGoogleSheetsConfigured } from '@/lib/google-sheets'
import { google } from 'googleapis'

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) return null
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 503 })
  }

  const db = supabaseServer()

  const { data: registration, error: regErr } = await db
    .from('registrations')
    .select('id, event_title, school_name, teacher_email, type')
    .eq('id', params.id)
    .maybeSingle()

  if (regErr || !registration) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  }

  const reg = registration as {
    id: string; event_title: string; school_name: string | null
    teacher_email: string | null; type: string
  }

  if (reg.type !== 'group') {
    return NextResponse.json({ error: 'Only available for group registrations' }, { status: 400 })
  }

  const { data: participants } = await db
    .from('participants')
    .select('membership_id, event_role, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, grade, dietary_requirements, health_conditions, emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email, emergency_contact_phone')
    .eq('registration_id', params.id)
    .order('event_role') // Teachers first, then Adults, then Students

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
  const auth = getAuth()!
  const sheets = google.sheets({ version: 'v4', auth })
  const drive = google.drive({ version: 'v3', auth })

  const title = `${reg.event_title} — ${reg.school_name ?? 'Group'} Participants`

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

  // Format header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
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
        // Column widths
        ...([130, 80, 120, 120, 200, 130, 120, 90, 110, 140, 200, 180, 180, 180, 200, 180].map((w, i) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: w },
            fields: 'pixelSize',
          },
        }))),
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

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return NextResponse.redirect(url, { status: 302 })
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
