-- ============================================================================
-- SUCCESSFACTORS MIGRATION STUDIO - SUPABASE DB SCHEMA (sf_objects / sf_fields)
-- ============================================================================

-- Drop existing legacy tables to allow clean re-runs
DROP TABLE IF EXISTS dynamic_rules CASCADE;
DROP TABLE IF EXISTS transformed_data CASCADE;
DROP TABLE IF EXISTS cleansed_data CASCADE;
DROP TABLE IF EXISTS validation_report CASCADE;
DROP TABLE IF EXISTS harmonized_data CASCADE;
DROP TABLE IF EXISTS extracted_data CASCADE;
DROP TABLE IF EXISTS user_corrected_mappings CASCADE;
DROP TABLE IF EXISTS ai_mapping_cache CASCADE;
DROP TABLE IF EXISTS source_fields CASCADE;
DROP TABLE IF EXISTS source_systems CASCADE;
DROP TABLE IF EXISTS sf_fields CASCADE;
DROP TABLE IF EXISTS sf_objects CASCADE;
DROP TABLE IF EXISTS sap_fields CASCADE;
DROP TABLE IF EXISTS sap_objects CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- Create extension for UUID if it doesn't exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- Core Setup & Metadata Tables
-- ==========================================

-- 1. Projects Workspace Table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. SuccessFactors Target Objects Table (Biographical Info, Job Info, etc.)
CREATE TABLE sf_objects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. SuccessFactors Target Fields Metadata Table
CREATE TABLE sf_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    object_id UUID NOT NULL REFERENCES sf_objects(id) ON DELETE CASCADE,
    sheet_name TEXT,
    group_name TEXT,
    field_description TEXT,
    type TEXT,
    length TEXT,
    decimals TEXT,
    sf_structure TEXT,
    field_name TEXT NOT NULL,
    is_mandatory BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (object_id, sf_structure, field_name)
);

-- 4. Source Systems Registry Table (SAP_HCM, ORACLE_HR, WORKDAY, EXCEL_CSV)
CREATE TABLE source_systems (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Source Fields Registry Table
CREATE TABLE source_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_system_id UUID NOT NULL REFERENCES source_systems(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES sf_objects(id) ON DELETE CASCADE,
    sf_field_id UUID REFERENCES sf_fields(id) ON DELETE SET NULL,
    source_table TEXT,
    source_field_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (source_system_id, object_id, source_table, source_field_name)
);

-- ==========================================
-- STAGE 1: EXTRACTION & INGESTION TABLE
-- ==========================================

CREATE TABLE extracted_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES sf_objects(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- STAGE 2: AI MAPPING TABLES
-- ==========================================

CREATE TABLE ai_mapping_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_system_id UUID NOT NULL REFERENCES source_systems(id) ON DELETE CASCADE,
    source_field_id UUID NOT NULL REFERENCES source_fields(id) ON DELETE CASCADE,
    sf_field_id UUID NOT NULL REFERENCES sf_fields(id) ON DELETE CASCADE,
    transform_rule TEXT,
    confidence_score INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (source_system_id, source_field_id, sf_field_id)
);

CREATE TABLE user_corrected_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_system_id UUID NOT NULL REFERENCES source_systems(id) ON DELETE CASCADE,
    source_field_name TEXT NOT NULL,
    sf_field_id UUID NOT NULL REFERENCES sf_fields(id) ON DELETE CASCADE,
    transform_rule TEXT,
    confidence INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- STAGE 3: HARMONIZATION TABLE
-- ==========================================

CREATE TABLE harmonized_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    object_id UUID REFERENCES sf_objects(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- STAGE 4: CLEANSING & VALIDATION TABLES
-- ==========================================

CREATE TABLE dynamic_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    object_id UUID REFERENCES sf_objects(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE validation_report (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    object_id UUID REFERENCES sf_objects(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cleansed_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    object_id UUID REFERENCES sf_objects(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- STAGE 5: TRANSFORMATION TABLE
-- ==========================================

CREATE TABLE transformed_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    object_id UUID REFERENCES sf_objects(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- Enable RLS and Setup Policies
-- ==========================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_mapping_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_corrected_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE harmonized_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleansed_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE transformed_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read Access for sf_objects" ON sf_objects FOR SELECT USING (true);
CREATE POLICY "Public Read Access for sf_fields" ON sf_fields FOR SELECT USING (true);
CREATE POLICY "Public Read Access for source_systems" ON source_systems FOR SELECT USING (true);
CREATE POLICY "Public Read Access for source_fields" ON source_fields FOR SELECT USING (true);
CREATE POLICY "Public Read Access for ai_mapping_cache" ON ai_mapping_cache FOR SELECT USING (true);

CREATE POLICY "Public Access for projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for user_corrected_mappings" ON user_corrected_mappings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for extracted_data" ON extracted_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for harmonized_data" ON harmonized_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for dynamic_rules" ON dynamic_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for validation_report" ON validation_report FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for cleansed_data" ON cleansed_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access for transformed_data" ON transformed_data FOR ALL USING (true) WITH CHECK (true);
