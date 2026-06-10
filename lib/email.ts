const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = 'Stellr Education <david.shaw@insimeducation.com>'

// Marketing/campaign sender — a separate, DNS-authenticated subdomain so bulk
// sends build (or burn) reputation independently of transactional mail above.
export const MARKETING_FROM =
  process.env.MARKETING_FROM ?? 'Stellr Education <hello@mail.stellreducation.org>'

interface EmailAttachment {
  filename: string
  /** Base64-encoded file content (Resend `content` field). */
  content: string
  contentType?: string
}

interface SendEmailOptions {
  to: string
  /** Override the default transactional sender (e.g. MARKETING_FROM for campaigns). */
  from?: string
  cc?: string[]
  replyTo?: string
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
}

export async function sendEmail({ to, from, cc, replyTo, subject, html, text, attachments }: SendEmailOptions) {
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
    body: JSON.stringify({
      from: from ?? FROM,
      to: [to],
      cc: cc ?? [],
      reply_to: replyTo,
      subject,
      html,
      text,
      ...(attachments && attachments.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              content_type: a.contentType,
            })),
          }
        : {}),
    }),
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
  participantCount, registrationId, paymentMethod, detailsMethod, spreadsheetUrl, joinUrl,
}: {
  teacherFirstName: string; teacherLastName: string; schoolName: string
  eventTitle: string; participantCount: number; registrationId: string
  paymentMethod: 'invoice' | 'card' | 'individual'
  detailsMethod: 'add_now' | 'spreadsheet' | 'email_link'
  spreadsheetUrl?: string; joinUrl?: string
}) {
  const subject = `Group Registration Received — ${eventTitle}`

  // ── "What happens next" — dynamic on how payment & registration were chosen ──
  const paymentNote =
    paymentMethod === 'card'
      ? `<li style="margin-bottom:8px"><strong>Payment:</strong> Your card payment for all ${participantCount} participant${participantCount !== 1 ? 's' : ''} has been processed — your group registration is confirmed.</li>`
    : paymentMethod === 'individual'
      ? '<li style="margin-bottom:8px"><strong>Payment:</strong> Each group member will receive their own payment link by email. Each member\'s spot is confirmed once they complete their individual payment.</li>'
      : `<li style="margin-bottom:8px"><strong>Payment:</strong> An invoice for all ${participantCount} participant${participantCount !== 1 ? 's' : ''} will be emailed to you within 1–2 business days. Registration is confirmed once payment is received.</li>`

  const registrationNote =
    detailsMethod === 'add_now'
      ? '<li style="margin-bottom:8px"><strong>Member details:</strong> All group member details have been submitted — there\'s nothing further to add.</li>'
      : '<li style="margin-bottom:8px"><strong>Member details:</strong> Complete your group\'s details using <strong>either</strong> option above — the pre-populated Google Sheet <strong>or</strong> the registration link. We\'ll finalise each member\'s registration as their details come in.</li>'

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
          ${registrationNote}
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
  const paymentText =
    paymentMethod === 'card'
      ? `Payment: card payment for all ${participantCount} participant${participantCount !== 1 ? 's' : ''} processed — registration confirmed.`
    : paymentMethod === 'individual'
      ? 'Payment: each group member will receive their own payment link by email; each spot is confirmed once that member pays.'
      : `Payment: an invoice for all ${participantCount} participant${participantCount !== 1 ? 's' : ''} will be emailed within 1–2 business days; registration is confirmed once paid.`
  const registrationText =
    detailsMethod === 'add_now'
      ? 'Member details: all details submitted — nothing further to add.'
      : 'Member details: complete your group\'s details using either the Google Sheet or the registration link below (whichever you prefer).'
  const text = `Hi ${teacherFirstName},\n\nGroup registration received for ${eventTitle}.\n\nSchool: ${schoolName}\nParticipants: ${participantCount}\nReference #: ${registrationId}\n\n${paymentText}\n${registrationText}${sheetText}${joinText}\n\n— Stellr Education`
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

// ── Adult / Mentor self-signed participation agreements ────────────────────────
// The signer is the participant themselves (no guardian), so these address the
// recipient directly. agreementLabel distinguishes the Adult vs Mentor document.

export function docusignSentToSignerEmail({
  firstName, eventTitle, agreementLabel,
}: {
  firstName: string; eventTitle: string; agreementLabel: string
}) {
  const subject = `Action required — ${agreementLabel} for ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Signature Required</h2>
        <p>Hi ${firstName},</p>
        <p>We've sent you the <strong>${agreementLabel}</strong> for <strong>${eventTitle}</strong> via DocuSign.</p>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:14px;color:#92400e">
            <strong>Your registration is not yet confirmed.</strong> Please review and sign the agreement to secure your place.
          </p>
        </div>
        <p style="color:#6b7280;font-size:14px">You'll receive a separate email from DocuSign with a link to review and sign. If it hasn't arrived, please check your spam folder.</p>
        <p style="color:#6b7280;font-size:14px">We'll send a reminder if the agreement hasn't been signed within one week. Once signed, you'll receive a confirmation with a copy of the completed document.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nWe've sent you the ${agreementLabel} for ${eventTitle} via DocuSign. Your registration is not yet confirmed until it's signed. Please check your inbox for an email from DocuSign.\n\n— Stellr Education`
  return { subject, html, text }
}

export function docusignReminderToSignerEmail({
  firstName, eventTitle, agreementLabel,
}: {
  firstName: string; eventTitle: string; agreementLabel: string
}) {
  const subject = `Reminder — ${agreementLabel} still required for ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Agreement Reminder</h2>
        <p>Hi ${firstName},</p>
        <p>We haven't yet received your signed <strong>${agreementLabel}</strong> for <strong>${eventTitle}</strong>.</p>
        <p>We've sent you another reminder via DocuSign. Please check your inbox (and spam folder) for an email from DocuSign.</p>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-size:14px;color:#92400e">
            <strong>Your registration remains unconfirmed</strong> until the agreement is signed. Please sign it as soon as possible.
          </p>
        </div>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nWe haven't received your signed ${agreementLabel} for ${eventTitle}. We've sent another reminder via DocuSign.\n\nYour registration remains unconfirmed until it's signed.\n\n— Stellr Education`
  return { subject, html, text }
}

export function docusignCompletedToSignerEmail({
  firstName, eventTitle, downloadUrl, agreementLabel,
}: {
  firstName: string; eventTitle: string; downloadUrl: string; agreementLabel: string
}) {
  const subject = `${agreementLabel} signed — ${eventTitle}`
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:22px">Stellr Education</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#1e3a5f;margin-top:0">Agreement Signed</h2>
        <p>Hi ${firstName},</p>
        <p>Thank you — your <strong>${agreementLabel}</strong> for <strong>${eventTitle}</strong> has been signed.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:24px 0">
          <p style="margin:0;font-weight:600;color:#14532d">Your registration is now confirmed!</p>
        </div>
        <p style="color:#374151;font-size:14px">A copy of the signed agreement is available to download from your member portal, or use the button below:</p>
        <div style="margin:24px 0;text-align:center">
          <a href="${downloadUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600">Download Agreement →</a>
        </div>
        <p style="color:#6b7280;font-size:14px">DocuSign has also sent a copy directly to your email.</p>
        <p style="color:#6b7280;font-size:14px">Questions? Reply to this email or visit <a href="https://www.stellreducation.org">stellreducation.org</a>.</p>
      </div>
      <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
        <p style="color:#9ca3af;font-size:12px;margin:0">© ${new Date().getFullYear()} Stellr Education. All rights reserved.</p>
      </div>
    </div>
  `
  const text = `Hi ${firstName},\n\nYour ${agreementLabel} for ${eventTitle} has been signed. Your registration is confirmed!\n\nDownload the signed agreement: ${downloadUrl}\n\n— Stellr Education`
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

// ── Community notification emails (FR-COM-06) ────────────────────────────────

export function communityReplyEmail({
  recipientFirstName,
  actorName,
  postTitle,
  postUrl,
}: {
  recipientFirstName: string
  actorName: string
  postTitle: string
  postUrl: string
}) {
  const subject = `${actorName} replied to your post — Stellr Community`
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <p style="font-size:16px;color:#111827">Hi ${recipientFirstName},</p>
      <p style="color:#374151"><strong>${actorName}</strong> replied to your post <em>${postTitle}</em> in the Stellr Community.</p>
      <a href="${postUrl}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#111827;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">View reply</a>
      <p style="color:#9ca3af;font-size:12px">You're receiving this because you posted in the Stellr Community. <a href="${postUrl}" style="color:#6b7280">Manage preferences</a> from your account settings.</p>
    </div>
  `
  const text = `Hi ${recipientFirstName},\n\n${actorName} replied to your post "${postTitle}".\n\nView it here: ${postUrl}\n\n— Stellr Community`
  return { subject, html, text }
}

export function communityAnnouncementEmail({
  recipientFirstName,
  title,
  body,
  url,
}: {
  recipientFirstName: string
  title: string
  body: string
  url: string
}) {
  const subject = `New announcement: ${title} — Stellr Community`
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <p style="font-size:16px;color:#111827">Hi ${recipientFirstName},</p>
      <h2 style="font-size:18px;color:#111827;margin:0 0 8px">${title}</h2>
      <p style="color:#374151">${body}</p>
      <a href="${url}" style="display:inline-block;margin:16px 0;padding:10px 20px;background:#111827;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">Read in community</a>
    </div>
  `
  const text = `Hi ${recipientFirstName},\n\nNew announcement: ${title}\n\n${body}\n\nRead it here: ${url}\n\n— Stellr Community`
  return { subject, html, text }
}
