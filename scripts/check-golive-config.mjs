// Throwaway functional checks for the two go-live prerequisites.
// Runs the exact API calls the app makes, then cleans up. Safe to delete.
import 'dotenv/config'
import { google } from 'googleapis'
import { createClerkClient } from '@clerk/backend'

const OWNER_EMAIL = process.env.GOOGLE_SHEET_OWNER_EMAIL ?? 'david.shaw@insimeducation.com'

function googleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const subject = process.env.GOOGLE_IMPERSONATE_USER ?? OWNER_EMAIL
  if (!email || !key) return null
  return new google.auth.JWT({
    email, key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    subject,
  })
}

async function checkGoogleAnyoneSharing() {
  console.log('\n=== #1 Google Drive: anyone-with-link sharing ===')
  const auth = googleAuth()
  if (!auth) { console.log('❌ Google service account env vars missing'); return }
  const sheets = google.sheets({ version: 'v4', auth })
  const drive = google.drive({ version: 'v3', auth })
  let fileId
  try {
    const created = await sheets.spreadsheets.create({
      requestBody: { properties: { title: '[go-live check] DELETE ME' } },
    })
    fileId = created.data.spreadsheetId
    console.log(`   created test sheet: ${fileId} (impersonating ${process.env.GOOGLE_IMPERSONATE_USER ?? OWNER_EMAIL})`)
    await drive.permissions.create({
      fileId,
      requestBody: { type: 'anyone', role: 'writer' },
    })
    console.log('✅ PASS — anyone-with-link (writer) sharing is ALLOWED. The frictionless flow will work.')
  } catch (err) {
    const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason
    const msg = err?.message ?? String(err)
    console.log(`❌ FAIL — could not set anyone-with-link permission.`)
    console.log(`   reason: ${reason ?? 'unknown'}`)
    console.log(`   message: ${msg}`)
    console.log('   → Workspace likely restricts external/link sharing. Fix in Admin console → Drive and Docs → Sharing settings.')
  } finally {
    if (fileId) {
      try { await drive.files.delete({ fileId }); console.log('   cleaned up test sheet.') }
      catch (e) { console.log(`   ⚠️ could not delete test sheet ${fileId} — delete manually. (${e?.message})`) }
    }
  }
}

async function checkClerkCreateUser() {
  console.log('\n=== #2 Clerk: backend createUser (skipPasswordRequirement) ===')
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret) { console.log('❌ CLERK_SECRET_KEY missing'); return }
  console.log(`   instance: ${secret.startsWith('sk_live') ? 'PRODUCTION' : 'development/test'}`)
  const clerk = createClerkClient({ secretKey: secret })
  const testEmail = `golive-check+${Date.now()}@example.com`
  let userId
  try {
    const user = await clerk.users.createUser({
      emailAddress: [testEmail],
      firstName: 'GoLive',
      lastName: 'Check',
      skipPasswordRequirement: true,
    })
    userId = user.id
    console.log(`✅ PASS — createUser succeeded (${userId}).`)
    // Also confirm a sign-in token can be minted (the other half of the flow).
    const tok = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 })
    console.log(`✅ PASS — signInToken minted (len ${tok.token?.length ?? 0}). Ticket flow viable.`)
  } catch (err) {
    const errs = err?.errors ?? err?.clerkError ? err.errors : undefined
    console.log('❌ FAIL — backend user creation failed.')
    console.log(`   message: ${err?.message ?? String(err)}`)
    if (errs) console.log(`   details: ${JSON.stringify(errs)}`)
    console.log('   → Check Clerk dashboard → Email/Phone/Username: username & phone must not be REQUIRED.')
  } finally {
    if (userId) {
      try { await clerk.users.deleteUser(userId); console.log('   cleaned up test user.') }
      catch (e) { console.log(`   ⚠️ could not delete test user ${userId} — delete manually. (${e?.message})`) }
    }
  }
}

await checkGoogleAnyoneSharing()
await checkClerkCreateUser()
console.log('\nDone.')
