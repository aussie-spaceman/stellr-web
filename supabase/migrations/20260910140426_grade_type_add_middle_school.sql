-- Add grades 6, 7 and 8 to grade_type.
--
-- Colorado 2027 opened its Space Design Challenge to grades 7–12 (the flyer and
-- the event page both say so). `participants.grade` is text and already accepts
-- "7", but `members.grade` is this enum — so normalizeGrade('7') resolved to
-- grade_7, found no such value, and returned NULL. A seventh-grader could
-- register and appear on the roster while their member profile silently carried
-- no grade at all.
--
-- 6 goes in with them: the "Middle School" bracket has always meant 6–8, so the
-- moment a form offers the band it actually describes, grade 6 is reachable and
-- would hit exactly the same NULL.
--
-- Split from the promote_grades() update that follows it: ALTER TYPE ... ADD
-- VALUE cannot be used by anything in the same transaction, and the plpgsql
-- validator resolves the 'grade_8'::grade_type casts in that function body at
-- CREATE time. Two files, two transactions, no ordering trap.
--
-- BEFORE 'grade_9' keeps the enum in school order, which matters: the enum's
-- declaration order is its sort order, and rosters order by grade.

ALTER TYPE public.grade_type ADD VALUE IF NOT EXISTS 'grade_6' BEFORE 'grade_9';
ALTER TYPE public.grade_type ADD VALUE IF NOT EXISTS 'grade_7' BEFORE 'grade_9';
ALTER TYPE public.grade_type ADD VALUE IF NOT EXISTS 'grade_8' BEFORE 'grade_9';
