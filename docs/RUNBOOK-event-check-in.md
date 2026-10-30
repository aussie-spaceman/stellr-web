# RUNBOOK — Running check-in at an in-person event

**Applies to:** staff and event managers running the registration desk. The
check-in banner (Oct 2026) replaced the per-event door poster as the main way
in; the poster still works. School groups are checked in as a group at the
desk, and the desk can scan check-in codes (Oct 2026, after the check-in app
review). Background: `docs/handovers/HANDOVER-event-check-in-v2-2026-10-08.md`.

## The banner

One printed banner travels to every event. Its QR code is the fixed address
`stellreducation.org/check-in`. It sends a phone to whichever **in-person**
event has check-in open, where people enter their name and date of birth. If
none is open, it shows "Check-in isn't open yet" and points them to the desk.

- QR files for the designer: admin → Competitions → **Check-in banner** (SVG for
  print, 3000px PNG). Download them from the live admin, not the dev site.
- The banner never needs reprinting: **Regenerate code** on an event does not
  affect it.

## Check-in codes

Every participant and every school group has a check-in code (a QR). The desk
scans it instead of searching a name.

- **Participants** get a "Show my check-in code" button in their confirmation
  email, and the code can be printed on their badge (below).
- **Teachers** get their group's code in the group confirmation email and on
  the event page under **Your group** ("Show our check-in code").
- People registered before 30 Oct 2026 got no code by email. Print codes on
  the badges, or check them in by name or by group.

## Before the day

1. Hand-assign each mentor a company in the roster. Run auto-assign for
   students first.
2. Competition → Check-in → paste the event's Google Drive folder link into
   **Event documents** and save.
3. Badges: Competition → Settings → **Name badges**. Tick **Print in school
   order** so each group's badges come off the printer together, and hand each
   teacher their group's badges at check-in. Tick **Add check-in QR codes** to
   print each person's code in the bottom-right corner (leave that corner clear
   in the artwork).
4. Set up each desk device (an iPad is best): sign in, open Competition →
   Check-in, switch on **Desk mode**, then Share → **Add to Home Screen**. Open
   the desk from the home screen icon once while online. It then opens full
   screen and reloads even with no connection.

## On the day

1. When the doors open: **Open check-in**. If another in-person event is still
   open, the console asks first; opening this one closes the other. The console
   then shows "The check-in banner points here."
2. Put the banner at the start of the line. People with phones check themselves
   in while they wait.
3. **A school group arrives:** tap **Groups**, find the school (or scan the
   teacher's group code), and tap **Check in group**. Everyone not yet here
   starts ticked: untick whoever isn't on the bus, then **Check in**. **Undo**
   appears straight after if you picked the wrong group. **Call** rings the
   teacher of a group that hasn't arrived.
4. **One person:** tap **Scan** and hold their badge or phone up to the camera
   (it keeps scanning), or search their name, school or teacher and tap
   **Check in**. People show their phone screen: company number plus shirt
   size.
5. **Flags** on a person: *Form not signed*, *Unpaid*, *Medical*, *Dietary*.
   Tap **Details** to read them. Flags never stop a check-in: check the student
   in and follow up.
6. **Wi-Fi drops:** keep going. The header says **Offline** and how many check-ins
   are waiting to send. They go, with the time they happened, as soon as the
   connection is back. Don't sign out while it says something is waiting.
7. **Close check-in** at the end of the day. A participant's phone still opens
   their own page afterwards (documents, survey).

Virtual events are separate: their check-in is the emailed link, the banner
ignores them, and opening one never closes an in-person event.
