-- SITEPIX AI normalized PostgreSQL starting schema (migration scaffold only).
-- Apply only after reviewing tenant, retention, and access-control requirements.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  auth_provider text,
  auth_subject text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','estimator','marketing','staff','read_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, phone text, email text, trade text, source text, status text NOT NULL DEFAULT 'New', notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_org_status_idx ON leads(organization_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL, customer_name text, customer_address text, trade text, scope_notes text, media_object_key text, status text NOT NULL DEFAULT 'Needs review',
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contractor_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  primary_trade text NOT NULL DEFAULT 'General Contractor', service_area text,
  home_base_address text, labor_rate numeric NOT NULL DEFAULT 65 CHECK (labor_rate >= 0),
  labor_burden_pct numeric NOT NULL DEFAULT 0 CHECK (labor_burden_pct >= 0),
  materials_markup_pct numeric NOT NULL DEFAULT 20 CHECK (materials_markup_pct >= 0),
  vehicle_cost_per_mile numeric NOT NULL DEFAULT 0.70 CHECK (vehicle_cost_per_mile >= 0),
  default_round_trips integer NOT NULL DEFAULT 1 CHECK (default_round_trips >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, label text NOT NULL, value numeric,
  unit text, confidence numeric CHECK (confidence >= 0 AND confidence <= 1), source text, requires_field_verification boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL, customer_name text, title text NOT NULL, currency char(3) NOT NULL DEFAULT 'USD',
  customer_address text, materials numeric NOT NULL DEFAULT 0, material_markup_pct numeric NOT NULL DEFAULT 0, material_markup numeric NOT NULL DEFAULT 0,
  labor_hours numeric, labor_rate numeric NOT NULL DEFAULT 0, labor_burden_pct numeric NOT NULL DEFAULT 0, labor numeric NOT NULL DEFAULT 0, other_costs numeric NOT NULL DEFAULT 0,
  travel_excluded boolean NOT NULL DEFAULT true, total numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'Draft',
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb, exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_sources jsonb NOT NULL DEFAULT '[]'::jsonb, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS travel_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL, customer_name text, origin_address text NOT NULL, destination_address text NOT NULL,
  round_trips integer NOT NULL DEFAULT 1 CHECK (round_trips >= 1), one_way_miles numeric NOT NULL DEFAULT 0,
  one_way_drive_hours numeric NOT NULL DEFAULT 0, total_miles numeric NOT NULL DEFAULT 0, total_drive_hours numeric NOT NULL DEFAULT 0,
  route_source text, itemized_costs jsonb NOT NULL DEFAULT '[]'::jsonb, total numeric NOT NULL DEFAULT 0,
  included_in_bid boolean NOT NULL DEFAULT false CHECK (included_in_bid = false), created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS travel_estimates_org_created_idx ON travel_estimates(organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL, object_key text NOT NULL, original_filename text NOT NULL,
  content_type text NOT NULL, byte_size bigint NOT NULL CHECK (byte_size > 0), kind text NOT NULL DEFAULT 'project',
  consent_status text NOT NULL DEFAULT 'unconfirmed', retention_until timestamptz, created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_assets_org_created_idx ON media_assets(organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS phone_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_call_id text, caller_phone text, called_phone text, status text NOT NULL DEFAULT 'received', summary text,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb, recording_object_key text, converted_lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id), started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_calls_org_started_idx ON phone_calls(organization_id, started_at DESC);
CREATE TABLE IF NOT EXISTS cost_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item text NOT NULL, unit text NOT NULL, unit_price numeric NOT NULL CHECK (unit_price >= 0), currency char(3) NOT NULL DEFAULT 'USD',
  source_name text NOT NULL, source_date date, region text, postal_code text, delivery_available text NOT NULL DEFAULT 'unknown' CHECK (delivery_available IN ('yes','no','unknown')), source_url text, verified_by uuid REFERENCES users(id), verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_references_org_item_idx ON cost_references(organization_id, item);
CREATE TABLE IF NOT EXISTS social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform text NOT NULL, caption text NOT NULL, media_object_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'Draft for approval', approved_by uuid REFERENCES users(id), scheduled_at timestamptz,
  published_at timestamptz, external_post_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  processor text NOT NULL DEFAULT 'stripe', processor_customer_id text, processor_subscription_id text,
  plan text NOT NULL CHECK (plan IN ('Solo','Pro','Growth')), measure_bid_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending', current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  referral_code text NOT NULL UNIQUE, referred_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'created', reward_status text NOT NULL DEFAULT 'none', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, resource_type text, resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
-- Before production: enforce organization_id scoping in every query; consider PostgreSQL RLS,
-- set tenant context only from authenticated server-side identity, and add retention/deletion jobs.
