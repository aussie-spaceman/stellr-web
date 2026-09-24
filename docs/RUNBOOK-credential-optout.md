# RUNBOOK — Guardian asks for a student's credentials to stay private

**Applies to:** any email/phone request from a parent or guardian of a student
under 18 to stop credential pages being public. Privacy Policy §7.4 promises
this route (privacy@stellreducation.org).

1. Confirm the requester is the guardian on the student's consent form
   (admin → Consent forms; match name and email).
2. On that student's **original** consent form row (not a coverage row), tick
   **Credential sharing opt-out**.
3. The app then, automatically:
   - makes every public credential page for that student private;
   - emails the guardian (student Cc'd) listing the pages changed and asking
     them to remove any LinkedIn entries or posts themselves;
   - logs `credential_sharing_opt_out` on the member timeline.
4. Reply to the guardian confirming it is done. Say plainly that Stellr cannot
   remove anything already added to LinkedIn — they or the student must delete
   it there.
5. Reversing: untick the box. Pages stay private; the student can make them
   public again.

No consent form on file → the student cannot make pages public anyway; reply
confirming that and note the request on the member record.
