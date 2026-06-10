const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = 'Stellr Education <david.shaw@insimeducation.com>'

interface SendEmailOptions {
  to: string
  cc?: string[]
  replyTo?: string
  subject: string
  html: string
  text: string
}

export async function sendEmail({ to, cc, replyTo, subject, html, text }: SendEmailOptions) {
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
    body: JSON.stringify({ from: FROM, to: [to], cc: cc ?? [], reply_to: replyTo, subject, html, text }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[email] Resend error sending to', to, '—', err)
    throw new Error(`Failed to send email: ${err}`)
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function individualConfirmationEmail({
  firstName, lastName, membershipId, eventTitle, registrationId,
}: {
  firstName: string; lastName: string; membershipId: string
  eventTitle: string; registrationId: string
}) {
  const subject = `Registration Confirmed — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">You're registered!</h2>
        <p>Hi ${firstName},</p>
        <p>Your registration for <strong>${eventTitle}</strong> has been confirmed and payment received. We look forward to seeing you there.</p>
        <table style="border-collapse:collapse;width:100%;margin:24px 0;background:#f9fafb;border-radius:8px">
          <tr><td style="padding:12px 16px;font-weight:600;color:#374151;width:40%">Name</td><td style="padding:12px 16px">${firstName} ${lastName}</td></tr>
          <tr style="background:#f3f4f6"><td style="padding:12px 16px;font-weight:600;color:#374151">Membership ID</td><td style="padding:12px 16px;font-family:monospace">${membershipId}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:600;color:#374151">Event</td><td style="padding:12px 16px">${eventTitle}</td></tr>
          <tr style="background:#f3f4f6"><td style="padding:12px 16px;font-weight:600;color:#374151">Reference #</td><td style="padding:12px 16px;font-family:monospace;color:#6b7280;font-size:12px">${registrationId}</td></tr>
        </table>
        <p style="color:#6b7280;font-size:14px">Keep your Membership ID handy — you'll use it to check in at the event.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nYour registration for ${eventTitle} is confirmed.\n\nMembership ID: ${membershipId}\nReference #: ${registrationId}\n\nKeep your Membership ID for check-in.\n\n— Stellr Education`
  return { subject, html, text }
}

export function groupConfirmationEmail({
  teacherFirstName, teacherLastName, schoolName, eventTitle,
  participantCount, registrationId, paymentMethod, spreadsheetUrl, joinUrl,
}: {
  teacherFirstName: string; teacherLastName: string; schoolName: string
  eventTitle: string; participantCount: number; registrationId: string
  paymentMethod: 'invoice' | 'card'; spreadsheetUrl?: string; joinUrl?: string
}) {
  const subject = `Group Registration Received — ${eventTitle}`

  const paymentNote = paymentMethod === 'invoice'
    ? '<li style="margin-bottom:8px">An invoice will be emailed to you within 1–2 business days. Registration is confirmed upon payment.</li>'
    : '<li style="margin-bottom:8px">Your card payment has been processed. Registration is confirmed.</li>'

  const sheetSection = spreadsheetUrl ? `
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0 0 8px;font-weight:600;color:#1e3a5f">📄 Option 1 — Pre-Populated Spreadsheet</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151">Fill in your group members' details using this pre-formatted Google Sheet, then return it to Stellr.</p>
      <a href="${spreadsheetUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">Open Google Sheet →</a>
    </div>
  ` : ''

  const joinSection = joinUrl ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0 0 8px;font-weight:600;color:#14532d">🔗 Option 2 — Email Registration Link</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151">Forward this link to your group members. Each member clicks it, signs in or creates a free Stellr account, and confirms their participation. You'll be notified as each member completes their registration.</p>
      <a href="${joinUrl}" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600">Copy Registration Link →</a>
      <p style="margin:10px 0 0;font-size:11px;color:#6b7280;word-break:break-all">${joinUrl}</p>
    </div>
  ` : ''

  const bothOptions = (sheetSection || joinSection) ? `
    <p style="font-weight:600;color:#374151;margin-bottom:4px">Group member details — two options:</p>
    <p style="font-size:13px;color:#6b7280;margin-top:0 0 12px">Use whichever works best for you, or both.</p>
    ${sheetSection}
    ${joinSection}
  ` : ''

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Group Registration Received</h2>
        <p>Hi ${teacherFirstName},</p>
        <p>We've received your group registration for <strong>${eventTitle}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;margin:24px 0;background:#f9fafb;border-radius:8px">
          <tr><td style="padding:12px 16px;font-weight:600;color:#374151;width:40%">Teacher / Coordinator</td><td style="padding:12px 16px">${teacherFirstName} ${teacherLastName}</td></tr>
          <tr style="background:#f3f4f6"><td style="padding:12px 16px;font-weight:600;color:#374151">School</td><td style="padding:12px 16px">${schoolName}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:600;color:#374151">Event</td><td style="padding:12px 16px">${eventTitle}</td></tr>
          <tr style="background:#f3f4f6"><td style="padding:12px 16px;font-weight:600;color:#374151">Total Participants</td><td style="padding:12px 16px">${participantCount}</td></tr>
          <tr><td style="padding:12px 16px;font-weight:600;color:#374151">Reference #</td><td style="padding:12px 16px;font-family:monospace;color:#6b7280;font-size:12px">${registrationId}</td></tr>
        </table>
        ${bothOptions}
        <p style="font-weight:600;color:#374151;margin-bottom:8px">What happens next:</p>
        <ul style="color:#6b7280;font-size:14px;line-height:1.8;padding-left:20px">
          ${paymentNote}
          <li style="margin-bottom:8px">Parental permission forms sent via DocuSign to each student once confirmed</li>
          <li>Event details and schedule sent closer to the date</li>
        </ul>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const sheetText = spreadsheetUrl ? `\n\nOption 1 — Google Sheet: ${spreadsheetUrl}` : ''
  const joinText = joinUrl ? `\n\nOption 2 — Registration Link: ${joinUrl}` : ''
  const paymentText = paymentMethod === 'invoice'
    ? 'An invoice will be emailed within 1–2 business days.'
    : 'Card payment processed — registration confirmed.'
  const text = `Hi ${teacherFirstName},\n\nGroup registration received for ${eventTitle}.\n\nSchool: ${schoolName}\nParticipants: ${participantCount}\nReference #: ${registrationId}\n\n${paymentText}${sheetText}${joinText}\n\n— Stellr Education`
  return { subject, html, text }
}

export function groupMemberIndividualPaymentEmail({
  memberFirstName, memberLastName, eventTitle, registrationId, paymentUrl,
}: {
  memberFirstName: string; memberLastName: string
  eventTitle: string; registrationId: string; paymentUrl: string
}) {
  const subject = `Complete your payment — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Complete Your Registration</h2>
        <p>Hi ${memberFirstName},</p>
        <p>You've been registered for <strong>${eventTitle}</strong> as part of a group. To confirm your spot, please complete your individual payment.</p>
        <div style="margin:28px 0;text-align:center">
          <a href="${paymentUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600">Pay Now →</a>
        </div>
        <p style="color:#6b7280;font-size:14px">If you have any questions, reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
        <p style="color:#6b7280;font-size:12px">Reference: <span style="font-family:monospace">${registrationId}</span></p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${memberFirstName} ${memberLastName},\n\nYou've been registered for ${eventTitle}. Please complete your payment:\n\n${paymentUrl}\n\nReference: ${registrationId}\n\n— Stellr Education`
  return { subject, html, text }
}

export function groupJoinLinkEmail({
  registrantFirstName, registrantLastName, eventTitle, joinUrl,
}: {
  registrantFirstName: string; registrantLastName: string
  eventTitle: string; joinUrl: string
}) {
  const subject = `Share with your group — ${eventTitle} registration link`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Your Group Registration Link</h2>
        <p>Hi ${registrantFirstName},</p>
        <p>Your group registration for <strong>${eventTitle}</strong> has been submitted. Forward the link below to your group members so they can complete their registration details.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px;margin:24px 0">
          <p style="margin:0 0 12px;font-weight:600;color:#1e3a5f;font-size:14px">Group Registration Link</p>
          <p style="margin:0 0 16px;font-size:13px;color:#374151">Each group member should click this link, sign in (or create a free account), and confirm their participation.</p>
          <a href="${joinUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600">Open Registration Link →</a>
          <p style="margin:12px 0 0;font-size:11px;color:#6b7280;word-break:break-all">${joinUrl}</p>
        </div>
        <p style="font-weight:600;color:#374151;margin-bottom:8px">How it works:</p>
        <ul style="color:#6b7280;font-size:14px;line-height:1.8;padding-left:20px">
          <li>Share this email (or just the link) with each member of your group</li>
          <li>Each member clicks the link and signs in or creates a free Stellr account</li>
          <li>They confirm they're joining your group for ${eventTitle}</li>
          <li>You'll receive a notification each time a member completes their registration</li>
        </ul>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${registrantFirstName} ${registrantLastName},\n\nForward this link to your group members for ${eventTitle}:\n\n${joinUrl}\n\nEach member should click the link, sign in or create an account, and confirm their participation. You'll be notified when each member completes their registration.\n\n— Stellr Education`
  return { subject, html, text }
}

export function groupMemberJoinedEmail({
  registrantFirstName, memberFirstName, memberLastName, memberEmail, eventTitle, memberCount, totalExpected,
}: {
  registrantFirstName: string; memberFirstName: string; memberLastName: string
  memberEmail: string; eventTitle: string; memberCount: number; totalExpected: number
}) {
  const subject = `${memberFirstName} ${memberLastName} has joined your group — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">New Group Member Registered</h2>
        <p>Hi ${registrantFirstName},</p>
        <p><strong>${memberFirstName} ${memberLastName}</strong> (${memberEmail}) has completed their registration for <strong>${eventTitle}</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-weight:600;color:#166534">Group progress: ${memberCount} of ${totalExpected} members registered</p>
        </div>
        <p style="color:#6b7280;font-size:14px">Log in to your member portal to view the full status of your group.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${registrantFirstName},\n\n${memberFirstName} ${memberLastName} (${memberEmail}) has registered for your group at ${eventTitle}.\n\nGroup progress: ${memberCount} of ${totalExpected} members registered.\n\n— Stellr Education`
  return { subject, html, text }
}

export function studentLeftTeamEmail({
  teacherFirstName, studentFirstName, studentLastName, studentEmail, eventTitle,
}: {
  teacherFirstName: string; studentFirstName: string; studentLastName: string
  studentEmail: string; eventTitle: string
}) {
  const subject = `${studentFirstName} ${studentLastName} has left your team — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Team Member Removed</h2>
        <p>Hi ${teacherFirstName},</p>
        <p><strong>${studentFirstName} ${studentLastName}</strong> (${studentEmail}) has removed themselves from your team for <strong>${eventTitle}</strong>.</p>
        <p style="color:#6b7280;font-size:14px">You may want to update your team details or find a replacement. Log in to your member portal to manage your team.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${teacherFirstName},\n\n${studentFirstName} ${studentLastName} (${studentEmail}) has removed themselves from your team for ${eventTitle}.\n\nLog in to your member portal to manage your team.\n\n— Stellr Education`
  return { subject, html, text }
}

export function docusignSentToMinorEmail({
  firstName, guardianName, guardianEmail, eventTitle,
}: {
  firstName: string; guardianName: string; guardianEmail: string; eventTitle: string
}) {
  const subject = `Action required — parental consent for ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Parental Consent Required</h2>
        <p>Hi ${firstName},</p>
        <p>We have sent a parental consent form to <strong>${guardianName}</strong> (${guardianEmail}) for your participation in <strong>${eventTitle}</strong>.</p>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:14px;color:#92400e">
            <strong>Your registration is not yet confirmed.</strong> Your parent or guardian needs to review and sign the consent form before your spot is secured. Please let them know to check their inbox.
          </p>
        </div>
        <p style="color:#6b7280;font-size:14px">They will receive a separate email from DocuSign with a link to review and sign. If they haven't received it, ask them to check their spam folder.</p>
        <p style="color:#6b7280;font-size:14px">We will send a reminder if the form hasn't been signed within one week. Once signed, you'll receive a confirmation email with a copy of the completed form.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nA parental consent form has been sent to ${guardianName} (${guardianEmail}) for your participation in ${eventTitle}.\n\nYour registration is not yet confirmed until the form is signed. Please ask your parent or guardian to check their inbox for an email from DocuSign.\n\n— Stellr Education`
  return { subject, html, text }
}

export function docusignReminderToMinorEmail({
  firstName, guardianName, eventTitle,
}: {
  firstName: string; guardianName: string; eventTitle: string
}) {
  const subject = `Reminder — parental consent still required for ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Consent Form Reminder</h2>
        <p>Hi ${firstName},</p>
        <p>We haven't received a signed consent form from <strong>${guardianName}</strong> for your participation in <strong>${eventTitle}</strong>.</p>
        <p>We've sent them another reminder via DocuSign. Please let them know to check their inbox (and spam folder) for an email from DocuSign.</p>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:14px;color:#92400e">
            <strong>Your registration remains unconfirmed</strong> until the consent form is signed. Please follow up with your parent or guardian as soon as possible.
          </p>
        </div>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nWe haven't received a signed consent form from ${guardianName} for ${eventTitle}. We've sent them another reminder.\n\nYour registration remains unconfirmed until the form is signed.\n\n— Stellr Education`
  return { subject, html, text }
}

export function docusignCompletedToMinorEmail({
  firstName, guardianName, eventTitle, downloadUrl,
}: {
  firstName: string; guardianName: string; eventTitle: string; downloadUrl: string
}) {
  const subject = `Consent form signed — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Consent Form Signed</h2>
        <p>Hi ${firstName},</p>
        <p>Great news — <strong>${guardianName}</strong> has signed the parental consent form for your participation in <strong>${eventTitle}</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-weight:600;color:#14532d">Your registration is now confirmed!</p>
        </div>
        <p style="color:#374151;font-size:14px">A copy of the signed form is available to download from your member portal, or use the button below:</p>
        <div style="margin:24px 0;text-align:center">
          <a href="${downloadUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600">Download Consent Form →</a>
        </div>
        <p style="color:#6b7280;font-size:14px">DocuSign has also sent a copy directly to ${guardianName}.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\n${guardianName} has signed the parental consent form for ${eventTitle}. Your registration is confirmed!\n\nDownload the signed form: ${downloadUrl}\n\n— Stellr Education`
  return { subject, html, text }
}

export function groupPaymentConfirmedEmail({
  teacherFirstName, eventTitle, registrationId,
}: {
  teacherFirstName: string; eventTitle: string; registrationId: string
}) {
  const subject = `Payment Confirmed — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Payment Received — Registration Confirmed</h2>
        <p>Hi ${teacherFirstName},</p>
        <p>We've received your payment for <strong>${eventTitle}</strong>. Your group registration is now confirmed.</p>
        <p style="color:#6b7280;font-size:14px">Reference #: <span style="font-family:monospace">${registrationId}</span></p>
        <p style="color:#6b7280;font-size:14px">We'll be in touch with event details and parental permission forms closer to the date.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${teacherFirstName},\n\nPayment received for ${eventTitle}. Your group registration is confirmed.\n\nReference #: ${registrationId}\n\n— Stellr Education`
  return { subject, html, text }
}
