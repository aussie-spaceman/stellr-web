const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = 'Stellr Education <david.shaw@insimeducation.com>'

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailOptions) {
  if (!RESEND_API_KEY) {
    console.log('[email] No RESEND_API_KEY — would have sent to:', to, subject)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[email] Resend error:', err)
    throw new Error('Failed to send email')
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function individualConfirmationEmail({
  firstName,
  lastName,
  membershipId,
  eventTitle,
  registrationId,
}: {
  firstName: string
  lastName: string
  membershipId: string
  eventTitle: string
  registrationId: string
}) {
  const subject = `Registration Confirmed — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">You're registered! 🎉</h2>
        <p>Hi ${firstName},</p>
        <p>Your registration for <strong>${eventTitle}</strong> has been confirmed and payment received. We look forward to seeing you there.</p>
        <table style="border-collapse:collapse;width:100%;margin:24px 0;background:#f9fafb;border-radius:8px">
          <tr>
            <td style="padding:12px 16px;font-weight:600;color:#374151;width:40%">Name</td>
            <td style="padding:12px 16px;color:#111827">${firstName} ${lastName}</td>
          </tr>
          <tr style="background:#f3f4f6">
            <td style="padding:12px 16px;font-weight:600;color:#374151">Membership ID</td>
            <td style="padding:12px 16px;font-family:monospace;color:#111827">${membershipId}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-weight:600;color:#374151">Event</td>
            <td style="padding:12px 16px;color:#111827">${eventTitle}</td>
          </tr>
          <tr style="background:#f3f4f6">
            <td style="padding:12px 16px;font-weight:600;color:#374151">Reference #</td>
            <td style="padding:12px 16px;font-family:monospace;color:#6b7280;font-size:12px">${registrationId}</td>
          </tr>
        </table>
        <p style="color:#6b7280;font-size:14px">Keep your Membership ID handy — you'll use it to check in at the event. We'll send you further details closer to the date.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nYour registration for ${eventTitle} is confirmed.\n\nMembership ID: ${membershipId}\nReference #: ${registrationId}\n\nKeep your Membership ID handy for check-in. We'll be in touch with event details soon.\n\nQuestions? Visit stellreducation.org\n\n— Stellr Education`
  return { subject, html, text }
}

export function groupConfirmationEmail({
  teacherFirstName,
  teacherLastName,
  schoolName,
  eventTitle,
  participantCount,
  registrationId,
}: {
  teacherFirstName: string
  teacherLastName: string
  schoolName: string
  eventTitle: string
  participantCount: number
  registrationId: string
}) {
  const subject = `Group Registration Received — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Group Registration Received</h2>
        <p>Hi ${teacherFirstName},</p>
        <p>We've received your group registration for <strong>${eventTitle}</strong>. An invoice will be sent to you within 1–2 business days. Your group's registration will be confirmed upon receipt of payment.</p>
        <table style="border-collapse:collapse;width:100%;margin:24px 0;background:#f9fafb;border-radius:8px">
          <tr>
            <td style="padding:12px 16px;font-weight:600;color:#374151;width:40%">Teacher / Coordinator</td>
            <td style="padding:12px 16px;color:#111827">${teacherFirstName} ${teacherLastName}</td>
          </tr>
          <tr style="background:#f3f4f6">
            <td style="padding:12px 16px;font-weight:600;color:#374151">School</td>
            <td style="padding:12px 16px;color:#111827">${schoolName}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-weight:600;color:#374151">Event</td>
            <td style="padding:12px 16px;color:#111827">${eventTitle}</td>
          </tr>
          <tr style="background:#f3f4f6">
            <td style="padding:12px 16px;font-weight:600;color:#374151">Participants</td>
            <td style="padding:12px 16px;color:#111827">${participantCount}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-weight:600;color:#374151">Reference #</td>
            <td style="padding:12px 16px;font-family:monospace;color:#6b7280;font-size:12px">${registrationId}</td>
          </tr>
        </table>
        <p style="color:#374151;font-weight:600;margin-bottom:8px">What happens next:</p>
        <ol style="color:#6b7280;font-size:14px;line-height:1.8">
          <li>Invoice issued to this email within 1–2 business days</li>
          <li>Registration confirmed upon payment receipt</li>
          <li>Parental permission forms sent via DocuSign to each student</li>
          <li>Event details and schedule sent closer to the date</li>
        </ol>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${teacherFirstName},\n\nWe've received your group registration for ${eventTitle}.\n\nSchool: ${schoolName}\nParticipants: ${participantCount}\nReference #: ${registrationId}\n\nAn invoice will be sent within 1–2 business days. Registration is confirmed on payment.\n\nQuestions? Visit stellreducation.org\n\n— Stellr Education`
  return { subject, html, text }
}
