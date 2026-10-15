# RUNBOOK — Running check-in at an in-person event

**Applies to:** staff and event managers running the registration desk. The
check-in banner (Oct 2026) replaced the per-event door poster as the main way
in; the poster still works. Background: `docs/handovers/HANDOVER-event-check-in-v2-2026-10-08.md`.

## The banner

One printed banner travels to every event. Its QR code is the fixed address
`stellreducation.org/check-in`. It sends a phone to whichever **in-person**
event has check-in open, where people enter their name and date of birth. If
none is open, it shows "Check-in isn't open yet" and points them to the desk.

- QR files for the designer: admin → Competitions → **Check-in banner** (SVG for
  print, 3000px PNG). Download them from the live admin, not the dev site.
- The banner never needs reprinting: **Regenerate code** on an event does not
  affect it.

## On the day

1. Before the event, hand-assign each mentor a company in the roster. Run
   auto-assign for students first.
2. Competition → Check-in → paste the event's Google Drive folder link into
   **Event documents** and save.
3. When the doors open: **Open check-in**. If another in-person event is still
   open, the console asks first; opening this one closes the other. The console
   then shows "The check-in banner points here."
4. Put the banner at the start of the line. People check themselves in on
   their own phones while they wait. Optional: print the event's door poster
   as a backup.
5. At the desk, use the **Not arrived** tab. People show their phone screen:
   company number plus shirt size.
6. **Close check-in** at the end of the day. A participant's phone still opens
   their own page afterwards (documents, survey).

Virtual events are separate: their check-in is the emailed link, the banner
ignores them, and opening one never closes an in-person event.
