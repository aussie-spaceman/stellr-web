-- Migration 013: atomic comment_count maintenance for community_posts.
-- Avoids the race in a read-modify-write when concurrent replies land.

CREATE OR REPLACE FUNCTION public.increment_post_comment_count(p_post_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.community_posts
  SET comment_count = comment_count + 1,
      updated_at = now()
  WHERE id = p_post_id;
$$;

CREATE OR REPLACE FUNCTION public.decrement_post_comment_count(p_post_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.community_posts
  SET comment_count = greatest(comment_count - 1, 0),
      updated_at = now()
  WHERE id = p_post_id;
$$;
