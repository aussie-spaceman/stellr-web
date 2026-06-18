-- M4: Add due_date and training_module_id to session_actions (PRD §11).
-- Completing a linked training module auto-checks the action.
ALTER TABLE public.session_actions
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS training_module_id uuid REFERENCES public.training_modules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_actions_training
  ON public.session_actions (training_module_id) WHERE training_module_id IS NOT NULL;
