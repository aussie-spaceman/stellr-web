-- Wave 1d: per-member post read tracking for unread badges + Home feed.
CREATE TABLE IF NOT EXISTS public.community_post_reads (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  post_id   uuid NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, post_id)
);

ALTER TABLE public.community_post_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role all post_reads" ON public.community_post_reads;
CREATE POLICY "service_role all post_reads" ON public.community_post_reads
  TO service_role USING (true) WITH CHECK (true);

-- Unread published posts per space for a member (excludes the member's own posts).
-- A post is unread when there's no read row, or it was created after the last read.
CREATE OR REPLACE FUNCTION public.space_unread_counts(_member_id uuid)
RETURNS TABLE(space_id uuid, unread bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.space_id, count(*)::bigint
  FROM public.community_posts p
  LEFT JOIN public.community_post_reads r
    ON r.post_id = p.id AND r.member_id = _member_id
  WHERE p.status = 'published'
    AND p.author_member_id <> _member_id
    AND (r.post_id IS NULL OR p.created_at > r.read_at)
  GROUP BY p.space_id;
$function$;
