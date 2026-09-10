-- Teach the annual roll-forward about grades 6, 7 and 8.
--
-- promote_grades() moves every auto-promoting member up one grade at rollover.
-- It was written when 9 was the lowest grade we admitted, so a grade_7 member
-- would fall through to `ELSE grade` and stay in seventh grade forever — the
-- same silent staleness the function exists to prevent.
--
-- Everything else is unchanged: grade_12 still promotes to college_freshman and
-- moves the member to the 'college' age bracket, and the auto-promote flag is
-- still preserved through the update.

CREATE OR REPLACE FUNCTION public.promote_grades() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE members
  SET
    grade = CASE grade
      WHEN 'grade_6'           THEN 'grade_7'::grade_type
      WHEN 'grade_7'           THEN 'grade_8'::grade_type
      WHEN 'grade_8'           THEN 'grade_9'::grade_type
      WHEN 'grade_9'           THEN 'grade_10'::grade_type
      WHEN 'grade_10'          THEN 'grade_11'::grade_type
      WHEN 'grade_11'          THEN 'grade_12'::grade_type
      WHEN 'grade_12'          THEN 'college_freshman'::grade_type
      WHEN 'college_freshman'  THEN 'college_sophomore'::grade_type
      WHEN 'college_sophomore' THEN 'college_junior'::grade_type
      WHEN 'college_junior'    THEN 'college_senior'::grade_type
      WHEN 'college_senior'    THEN 'grad_phd'::grade_type
      ELSE grade
    END,
    age_bracket = CASE
      WHEN grade = 'grade_12' THEN 'college'::age_bracket_type
      ELSE age_bracket
    END,
    grade_auto_promote = true   -- preserve auto-promote flag through system update
  WHERE grade_auto_promote = true
    AND grade IS NOT NULL
    AND is_active = true;
END;
$$;
