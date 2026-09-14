-- ================================================================
-- Table: public.tech_docs
-- Description: Stores consolidated post-load audit reports, 
-- stage-by-stage waterfall metrics, and step reports for SF-DMS.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.tech_docs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL,
    object_id TEXT,
    source_id TEXT,
    source TEXT DEFAULT 'EXCEL_CSV',
    target_object TEXT NOT NULL,
    project_name TEXT,
    object_name TEXT,
    source_name TEXT,
    report_title TEXT DEFAULT 'Consolidated Master Report',
    pipeline_summary JSONB DEFAULT '{}'::jsonb,
    waterfall_stats JSONB DEFAULT '{}'::jsonb,
    comparison_stats JSONB DEFAULT '{}'::jsonb,
    step_reports JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tech_docs_project_id ON public.tech_docs(project_id);
CREATE INDEX IF NOT EXISTS idx_tech_docs_object_id ON public.tech_docs(object_id);
CREATE INDEX IF NOT EXISTS idx_tech_docs_source_id ON public.tech_docs(source_id);
CREATE INDEX IF NOT EXISTS idx_tech_docs_updated_at ON public.tech_docs(updated_at DESC);

-- Enable Row Level Security (RLS) with full read/write access
ALTER TABLE public.tech_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access on tech_docs" ON public.tech_docs;

CREATE POLICY "Allow all access on tech_docs" ON public.tech_docs
    FOR ALL
    TO public, anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- Force PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
