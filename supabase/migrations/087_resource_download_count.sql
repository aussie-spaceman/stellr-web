-- 087_resource_download_count.sql
-- Per-binary download counter (decision 3: display the aggregate). Powers the
-- "Most downloaded" catalogue sort and the admin index Downloads column. Counts
-- opens of the same binary across every object it's attached to (it's one file).

ALTER TABLE public.community_resources
  ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0;

-- Atomic increment (avoids read-modify-write races on concurrent opens).
CREATE OR REPLACE FUNCTION public.increment_resource_download(rid uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.community_resources SET download_count = download_count + 1 WHERE id = rid;
$$;
