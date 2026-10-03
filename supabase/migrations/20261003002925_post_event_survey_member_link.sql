-- Post-event survey: when a participant is linked to a member account, their
-- survey invitations and responses follow (handover A2 "re-associated"). There
-- is no single linking function — registration, group join, team edits and the
-- sheet sync all set participants.member_id — so this lives on the column.
-- lib/survey/member.ts also backfills on read, for rows linked before this ran.

CREATE OR REPLACE FUNCTION public.survey_follow_participant_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.member_id IS NOT NULL AND NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    UPDATE public.survey_invitations SET member_id = NEW.member_id
     WHERE participant_id = NEW.id AND member_id IS NULL;
    UPDATE public.survey_responses SET member_id = NEW.member_id
     WHERE participant_id = NEW.id AND member_id IS NULL;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.survey_follow_participant_member() FROM PUBLIC;

DROP TRIGGER IF EXISTS survey_follow_participant_member ON public.participants;
CREATE TRIGGER survey_follow_participant_member
  AFTER UPDATE OF member_id ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.survey_follow_participant_member();
