-- Jessica control-plane schema v1. This migration is intentionally data-free.
-- It creates no tenant, user, product, approval, publication, deployment, or key.

create schema if not exists private;
create schema if not exists api;

revoke all on schema private from public, anon, authenticated, service_role;
revoke all on schema api from public, anon, authenticated, service_role;
grant usage on schema private, api to authenticated;

alter default privileges for role postgres in schema private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema api revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema api revoke execute on functions from public, anon, authenticated, service_role;

create domain private.sha256 as text
  check (value ~ '^[0-9a-f]{64}$');
create domain private.identifier as text
  check (value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
create domain private.https_url as text
  check (value ~ '^https://[^/?#[:space:]]+(?::[0-9]{1,5})?/[^[:space:]]+$');
create domain private.https_origin as text
  check (value ~ '^https://[^/?#[:space:]]+(?::[0-9]{1,5})?$');

create table private.tenants (
  id private.identifier primary key,
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  display_name text not null check (display_name = btrim(display_name) and length(display_name) between 1 and 200),
  status text not null check (status in ('active', 'suspended', 'retired')),
  created_at timestamptz not null default now()
);

create table private.tenant_memberships (
  tenant_id private.identifier not null references private.tenants(id),
  user_id uuid not null references auth.users(id),
  membership_role text not null check (membership_role in ('reviewer', 'operator', 'publisher', 'administrator')),
  status text not null check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create or replace function private.is_tenant_member(target_tenant_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := auth.uid();
  if caller_id is null then
    return false;
  end if;
  return exists (
    select 1
    from private.tenant_memberships membership
    join private.tenants tenant on tenant.id = membership.tenant_id
    where membership.tenant_id = target_tenant_id
      and membership.user_id = caller_id
      and membership.status = 'active'
      and tenant.status = 'active'
  );
end;
$$;
revoke all on function private.is_tenant_member(text) from public, anon, service_role;
grant execute on function private.is_tenant_member(text) to authenticated;

create table private.sites (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  domain text not null check (
    domain = lower(domain)
    and domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  status text not null check (status in ('active', 'suspended', 'retired')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (domain)
);

create table private.frame_models (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  model_code text not null check (model_code = btrim(model_code) and model_code <> ''),
  name text not null check (name = btrim(name) and name <> ''),
  lens_width_mm numeric not null check (lens_width_mm > 0),
  bridge_width_mm numeric not null check (bridge_width_mm > 0),
  temple_length_mm numeric not null check (temple_length_mm > 0),
  frame_width_mm numeric not null check (frame_width_mm > 0),
  lens_height_mm numeric not null check (lens_height_mm > 0),
  frame_thickness_mm numeric check (frame_thickness_mm > 0),
  pantoscopic_tilt_deg numeric check (pantoscopic_tilt_deg between -45 and 45),
  face_wrap_deg numeric check (face_wrap_deg between 0 and 90),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, model_code)
);

create table private.frame_variants (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  frame_model_id private.identifier not null,
  sku text not null check (sku = btrim(sku) and sku <> ''),
  frame_color text not null check (frame_color = btrim(frame_color) and frame_color <> ''),
  frame_material text not null check (frame_material in ('acetate', 'metal', 'tr90', 'combination', 'other')),
  lens_type text not null check (lens_type in ('clear', 'tinted', 'mirror')),
  lens_color text,
  visible_light_transmission_pct numeric check (visible_light_transmission_pct between 0 and 100),
  commerce_product_id text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id, frame_model_id),
  unique (tenant_id, sku),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id)
);

create table private.source_assets (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  frame_model_id private.identifier not null,
  frame_variant_id private.identifier,
  kind text not null check (kind in ('front', 'left45', 'right45', 'leftSide', 'rightSide', 'top', 'marking', 'annotatedOverview', 'other')),
  object_key text not null check (object_key = btrim(object_key) and object_key <> '' and object_key !~ '(^/|\.\.)'),
  sha256 private.sha256 not null,
  byte_length bigint not null check (byte_length > 0),
  mime_type text not null check (mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  encoded_width_px integer,
  encoded_height_px integer,
  exif_orientation smallint,
  display_width_px integer,
  display_height_px integer,
  region_authoring text,
  provenance_sha256 private.sha256 not null,
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  inspected_at timestamptz not null,
  inspector_subject_id private.identifier not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id, frame_model_id),
  unique (tenant_id, sha256),
  unique (tenant_id, object_key),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id),
  foreign key (tenant_id, frame_variant_id, frame_model_id) references private.frame_variants(tenant_id, id, frame_model_id),
  check (
    (encoded_width_px is null and encoded_height_px is null and exif_orientation is null and display_width_px is null and display_height_px is null and region_authoring is null)
    or
    (encoded_width_px = width_px and encoded_height_px = height_px and exif_orientation between 1 and 8
      and display_width_px > 0 and display_height_px > 0
      and region_authoring in ('allowed', 'requires-orientation-normalized-derived-source')
      and ((exif_orientation = 1 and region_authoring = 'allowed') or (exif_orientation between 2 and 8 and region_authoring = 'requires-orientation-normalized-derived-source')))
  )
);

create table private.measurement_sets (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  frame_model_id private.identifier not null,
  version integer not null check (version > 0),
  method text not null check (method in ('marking', 'caliper', 'derived', 'mixed')),
  evidence_sha256 private.sha256 not null,
  status text not null check (status in ('draft', 'verified', 'superseded')),
  verified_by_subject_id private.identifier,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, frame_model_id, version),
  unique (tenant_id, evidence_sha256),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id),
  check ((status = 'verified') = (verified_by_subject_id is not null and verified_at is not null))
);

create table private.measurement_evidence (
  tenant_id private.identifier not null,
  measurement_set_id private.identifier not null,
  sequence integer not null check (sequence > 0),
  dimension text not null check (dimension in ('lensWidthMm', 'bridgeWidthMm', 'templeLengthMm', 'frameWidthMm', 'lensHeightMm', 'frameThicknessMm', 'pantoscopicTiltDeg', 'faceWrapDeg')),
  value numeric not null,
  source_asset_id private.identifier,
  source_sha256 private.sha256,
  raw_label text,
  method text not null check (method in ('marking', 'caliper', 'derived', 'assumption')),
  verification_status text not null check (verification_status in ('unverified', 'verified', 'not-applicable')),
  region_x integer,
  region_y integer,
  region_width integer,
  region_height integer,
  evidence_sha256 private.sha256 not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  recorded_at timestamptz not null,
  recorder_subject_id private.identifier not null,
  primary key (tenant_id, measurement_set_id, sequence),
  unique (tenant_id, measurement_set_id, dimension),
  unique (tenant_id, evidence_sha256),
  foreign key (tenant_id, measurement_set_id) references private.measurement_sets(tenant_id, id),
  foreign key (tenant_id, source_asset_id) references private.source_assets(tenant_id, id),
  check (
    (dimension in ('lensWidthMm', 'bridgeWidthMm', 'templeLengthMm', 'frameWidthMm', 'lensHeightMm', 'frameThicknessMm') and value > 0)
    or (dimension = 'pantoscopicTiltDeg' and value between -45 and 45)
    or (dimension = 'faceWrapDeg' and value between 0 and 90)
  ),
  check ((source_asset_id is null) = (source_sha256 is null)),
  check ((region_x is null and region_y is null and region_width is null and region_height is null)
    or (region_x >= 0 and region_y >= 0 and region_width > 0 and region_height > 0 and source_asset_id is not null))
);

create table private.generation_jobs (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  frame_model_id private.identifier not null,
  idempotency_key private.identifier not null,
  canonical_input_sha256 private.sha256 not null,
  method text not null check (method in ('proxy-auto', 'standard-auto', 'manual', 'external')),
  generator_id private.identifier not null,
  generator_version private.identifier not null,
  generator_config_sha256 private.sha256 not null,
  measurement_set_sha256 private.sha256 not null,
  generator_input_sha256 private.sha256 not null,
  max_attempts integer not null check (max_attempts > 0),
  created_at timestamptz not null,
  primary key (tenant_id, id),
  unique (tenant_id, id, frame_model_id),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, canonical_input_sha256),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id)
);

create table private.generation_job_events (
  tenant_id private.identifier not null,
  generation_job_id private.identifier not null,
  sequence integer not null check (sequence > 0),
  event_type text not null check (event_type in ('queued', 'claimed', 'lease-recovered', 'output-recorded', 'failed', 'retry-queued', 'cancelled', 'completed')),
  occurred_at timestamptz not null,
  previous_event_sha256 private.sha256,
  event_sha256 private.sha256 not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  primary key (tenant_id, generation_job_id, sequence),
  unique (tenant_id, event_sha256),
  foreign key (tenant_id, generation_job_id) references private.generation_jobs(tenant_id, id),
  check ((sequence = 1) = (previous_event_sha256 is null))
);

create table private.asset_versions (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  frame_model_id private.identifier not null,
  generation_job_id private.identifier,
  version integer not null check (version > 0),
  quality text not null check (quality in ('proxy', 'standard', 'premium')),
  generation_method text not null check (generation_method in ('proxy-auto', 'standard-auto', 'manual', 'external')),
  model_url private.https_url not null,
  manifest_url private.https_url not null,
  manifest_sha256 private.sha256 not null,
  manifest_byte_length bigint not null check (manifest_byte_length > 0),
  model_sha256 private.sha256 not null,
  model_byte_length bigint not null check (model_byte_length > 0),
  source_set_sha256 private.sha256 not null,
  attachment_matrix jsonb not null check (jsonb_typeof(attachment_matrix) = 'array' and jsonb_array_length(attachment_matrix) = 16),
  quality_envelope jsonb not null check (jsonb_typeof(quality_envelope) = 'object'),
  status text not null check (status in ('draft', 'review', 'approved', 'published', 'retired')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id, frame_model_id),
  unique (tenant_id, frame_model_id, version),
  unique (tenant_id, model_url),
  unique (tenant_id, manifest_url),
  unique (tenant_id, manifest_sha256),
  unique (tenant_id, model_sha256),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id),
  foreign key (tenant_id, generation_job_id, frame_model_id) references private.generation_jobs(tenant_id, id, frame_model_id),
  check (position('/v' || version::text || '/' in model_url) > 0),
  check (position('/v' || version::text || '/' in manifest_url) > 0),
  check (quality <> 'proxy' or status in ('draft', 'review', 'retired'))
);

create table private.asset_version_sources (
  tenant_id private.identifier not null,
  asset_version_id private.identifier not null,
  frame_model_id private.identifier not null,
  source_asset_id private.identifier not null,
  source_sha256 private.sha256 not null,
  primary key (tenant_id, asset_version_id, source_asset_id),
  unique (tenant_id, asset_version_id, source_sha256),
  foreign key (tenant_id, asset_version_id, frame_model_id) references private.asset_versions(tenant_id, id, frame_model_id),
  foreign key (tenant_id, source_asset_id, frame_model_id) references private.source_assets(tenant_id, id, frame_model_id)
);

create table private.qa_review_decisions (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  frame_model_id private.identifier not null,
  generation_job_id private.identifier not null,
  sequence integer not null check (sequence > 0),
  previous_decision_sha256 private.sha256,
  canonical_input_sha256 private.sha256 not null,
  review_head_event_sha256 private.sha256 not null,
  generator_input_sha256 private.sha256 not null,
  manifest_sha256 private.sha256 not null,
  manifest_byte_length bigint not null check (manifest_byte_length > 0),
  model_sha256 private.sha256 not null,
  model_byte_length bigint not null check (model_byte_length > 0),
  reviewer_subject_id private.identifier not null,
  decision text not null check (decision in ('approve', 'reject')),
  issue_categories text[] not null,
  notes text check (length(notes) between 1 and 2000 and notes = btrim(notes)),
  decision_sha256 private.sha256 not null,
  reviewed_at timestamptz not null,
  evaluated_at timestamptz not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  primary key (tenant_id, id),
  unique (tenant_id, generation_job_id, sequence),
  unique (tenant_id, decision_sha256),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id),
  foreign key (tenant_id, generation_job_id, frame_model_id) references private.generation_jobs(tenant_id, id, frame_model_id),
  check ((sequence = 1) = (previous_decision_sha256 is null)),
  check (reviewed_at <= evaluated_at),
  check ((decision = 'approve' and cardinality(issue_categories) = 0) or (decision = 'reject' and cardinality(issue_categories) > 0))
);

create table private.publication_authorities (
  tenant_id private.identifier not null references private.tenants(id),
  authority_id private.identifier not null,
  key_id private.identifier not null,
  public_jwk jsonb not null check (jsonb_typeof(public_jwk) = 'object'),
  public_jwk_sha256 private.sha256 not null,
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (tenant_id, authority_id, key_id),
  unique (tenant_id, public_jwk_sha256),
  check ((status = 'revoked') = (revoked_at is not null))
);

create table private.immutable_publication_resources (
  tenant_id private.identifier not null references private.tenants(id),
  resource_url private.https_url not null,
  resource_sha256 private.sha256 not null,
  byte_length bigint not null check (byte_length > 0),
  resource_kind text not null check (resource_kind in ('catalog', 'deployment-document')),
  recorded_at timestamptz not null,
  recorder_subject_id private.identifier not null,
  primary key (tenant_id, resource_url),
  unique (tenant_id, resource_url, resource_sha256)
);

create table private.deployments (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  site_id private.identifier not null,
  environment text not null check (environment in ('staging', 'production')),
  frame_model_id private.identifier not null,
  frame_variant_id private.identifier not null,
  sku text not null,
  asset_version_id private.identifier not null,
  asset_version integer not null check (asset_version > 0),
  revision bigint not null check (revision > 0),
  generation bigint not null check (generation > 0),
  activated_at timestamptz not null,
  authority_id private.identifier not null,
  key_id private.identifier not null,
  actor_subject_id private.identifier not null,
  change_id private.identifier not null,
  catalog_url private.https_url not null,
  allowed_origin private.https_origin not null,
  catalog_sha256 private.sha256 not null,
  manifest_sha256 private.sha256 not null,
  model_sha256 private.sha256 not null,
  prior_deployment_id private.identifier,
  prior_deployment_sha256 private.sha256,
  prior_revision bigint,
  prior_generation bigint,
  envelope_sha256 private.sha256 not null,
  deployment_sha256 private.sha256 not null,
  signature_base64url text not null check (signature_base64url ~ '^[A-Za-z0-9_-]+$'),
  signed_envelope jsonb not null check (jsonb_typeof(signed_envelope) = 'object'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, site_id, environment, revision),
  unique (tenant_id, site_id, environment, generation),
  unique (tenant_id, envelope_sha256),
  unique (tenant_id, deployment_sha256),
  unique (tenant_id, change_id),
  foreign key (tenant_id, site_id) references private.sites(tenant_id, id),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id),
  foreign key (tenant_id, frame_variant_id, frame_model_id) references private.frame_variants(tenant_id, id, frame_model_id),
  foreign key (tenant_id, asset_version_id, frame_model_id) references private.asset_versions(tenant_id, id, frame_model_id),
  foreign key (tenant_id, authority_id, key_id) references private.publication_authorities(tenant_id, authority_id, key_id),
  foreign key (tenant_id, catalog_url, catalog_sha256) references private.immutable_publication_resources(tenant_id, resource_url, resource_sha256),
  foreign key (tenant_id, prior_deployment_id) references private.deployments(tenant_id, id),
  check (catalog_url like allowed_origin || '/%'),
  check ((prior_deployment_id is null and prior_deployment_sha256 is null and prior_revision is null and prior_generation is null)
    or (prior_deployment_id is not null and prior_deployment_sha256 is not null and prior_revision > 0 and prior_generation > 0))
);

create table private.publication_streams (
  tenant_id private.identifier not null,
  site_id private.identifier not null,
  environment text not null check (environment in ('staging', 'production')),
  active_deployment_id private.identifier not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, site_id, environment),
  foreign key (tenant_id, site_id) references private.sites(tenant_id, id),
  foreign key (tenant_id, active_deployment_id) references private.deployments(tenant_id, id)
);

create table private.audit_events (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  event_type private.identifier not null,
  subject_id private.identifier not null,
  object_type private.identifier not null,
  object_id private.identifier not null,
  occurred_at timestamptz not null,
  previous_event_sha256 private.sha256,
  event_sha256 private.sha256 not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  primary key (tenant_id, id),
  unique (tenant_id, event_sha256)
);

create table private.publication_events (
  tenant_id private.identifier not null,
  id text not null,
  site_id private.identifier not null,
  environment text not null check (environment in ('staging', 'production')),
  event_type text not null check (event_type in ('activated', 'replaced', 'rollback')),
  deployment_id private.identifier not null,
  prior_deployment_id private.identifier,
  revision bigint not null check (revision > 0),
  generation bigint not null check (generation > 0),
  actor_subject_id private.identifier not null,
  occurred_at timestamptz not null,
  evidence_sha256 private.sha256 not null,
  primary key (tenant_id, id),
  unique (tenant_id, deployment_id),
  foreign key (tenant_id, deployment_id) references private.deployments(tenant_id, id),
  foreign key (tenant_id, prior_deployment_id) references private.deployments(tenant_id, id)
);

create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name;
end;
$$;

create or replace function private.validate_measurement_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_row private.source_assets%rowtype;
begin
  if new.source_asset_id is not null then
    select * into strict source_row from private.source_assets
      where tenant_id = new.tenant_id and id = new.source_asset_id;
    if new.source_sha256 <> source_row.sha256 then
      raise exception 'measurement source digest does not match inspected source';
    end if;
    if new.region_x is not null and (
      source_row.exif_orientation is distinct from 1
      or new.region_x + new.region_width > source_row.width_px
      or new.region_y + new.region_height > source_row.height_px
    ) then
      raise exception 'measurement region is outside allowed raw encoded geometry';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_generation_event_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prior private.generation_job_events%rowtype;
begin
  if new.sequence = 1 then
    if new.event_type <> 'queued' then raise exception 'first generation event must be queued'; end if;
  else
    select * into strict prior from private.generation_job_events
      where tenant_id = new.tenant_id and generation_job_id = new.generation_job_id and sequence = new.sequence - 1;
    if new.previous_event_sha256 <> prior.event_sha256 or new.occurred_at <= prior.occurred_at then
      raise exception 'generation event lineage must be hash-bound and monotonic';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published', 'retired') then raise exception 'published or retired asset is immutable'; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'asset identity, version, URLs, hashes, provenance, and geometry are immutable';
  end if;
  if not ((old.status = 'draft' and new.status in ('review', 'retired'))
    or (old.status = 'review' and new.status in ('approved', 'retired'))
    or (old.status = 'approved' and new.status in ('published', 'retired'))) then
    raise exception 'invalid asset status transition';
  end if;
  if old.quality = 'proxy' and new.status in ('approved', 'published') then
    raise exception 'proxy assets are non-promotable';
  end if;
  return new;
end;
$$;

create or replace function private.validate_qa_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  job private.generation_jobs%rowtype;
  review_head private.generation_job_events%rowtype;
  prior private.qa_review_decisions%rowtype;
begin
  select * into strict job from private.generation_jobs
    where tenant_id = new.tenant_id and id = new.generation_job_id and frame_model_id = new.frame_model_id;
  select * into strict review_head from private.generation_job_events
    where tenant_id = new.tenant_id and generation_job_id = new.generation_job_id
    order by sequence desc limit 1;
  if new.canonical_input_sha256 <> job.canonical_input_sha256
    or new.generator_input_sha256 <> job.generator_input_sha256
    or review_head.event_type <> 'output-recorded'
    or new.review_head_event_sha256 <> review_head.event_sha256 then
    raise exception 'QA decision must bind the exact job processing identity and current review head';
  end if;
  if new.sequence > 1 then
    select * into strict prior from private.qa_review_decisions
      where tenant_id = new.tenant_id and generation_job_id = new.generation_job_id and sequence = new.sequence - 1;
    if new.previous_decision_sha256 <> prior.decision_sha256 or new.reviewed_at <= prior.reviewed_at then
      raise exception 'QA decision lineage must be hash-bound and monotonic';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft' then
    raise exception 'new asset versions must enter as draft';
  end if;
  return new;
end;
$$;

create or replace function private.validate_publication_authority_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'revoked_at') is distinct from (to_jsonb(old) - 'status' - 'revoked_at') then
    raise exception 'publication authority identity and public key are immutable';
  end if;
  if old.status <> 'active' or old.revoked_at is not null
    or new.status <> 'revoked' or new.revoked_at is null or new.revoked_at < old.created_at then
    raise exception 'publication authority may only transition once from active to revoked';
  end if;
  return new;
end;
$$;

create or replace function private.validate_deployment_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_deployment private.deployments%rowtype;
  asset_row private.asset_versions%rowtype;
  variant_row private.frame_variants%rowtype;
  authority_row private.publication_authorities%rowtype;
  resource_row private.immutable_publication_resources%rowtype;
begin
  select * into strict asset_row from private.asset_versions
    where tenant_id = new.tenant_id and id = new.asset_version_id;
  select * into strict variant_row from private.frame_variants
    where tenant_id = new.tenant_id and id = new.frame_variant_id;
  select * into strict authority_row from private.publication_authorities
    where tenant_id = new.tenant_id and authority_id = new.authority_id and key_id = new.key_id;
  select * into strict resource_row from private.immutable_publication_resources
    where tenant_id = new.tenant_id and resource_url = new.catalog_url and resource_sha256 = new.catalog_sha256;
  if asset_row.status <> 'published' or asset_row.version <> new.asset_version
    or asset_row.frame_model_id <> new.frame_model_id
    or asset_row.manifest_sha256 <> new.manifest_sha256 or asset_row.model_sha256 <> new.model_sha256 then
    raise exception 'deployment must bind an exact published immutable asset';
  end if;
  if variant_row.frame_model_id <> new.frame_model_id or variant_row.sku <> new.sku then
    raise exception 'deployment selector does not match tenant variant';
  end if;
  if authority_row.status <> 'active' or authority_row.revoked_at is not null then
    raise exception 'deployment signing authority must be active';
  end if;
  if resource_row.resource_kind <> 'catalog' then
    raise exception 'deployment catalog resource must have catalog kind';
  end if;

  select deployment.* into current_deployment
  from private.publication_streams stream
  join private.deployments deployment
    on deployment.tenant_id = stream.tenant_id and deployment.id = stream.active_deployment_id
  where stream.tenant_id = new.tenant_id and stream.site_id = new.site_id and stream.environment = new.environment;

  if not found then
    if new.revision <> 1 or new.generation <> 1 or new.prior_deployment_id is not null then
      raise exception 'first deployment must start at revision and generation 1 without a prior pointer';
    end if;
  else
    if new.prior_deployment_id is distinct from current_deployment.id
      or new.prior_deployment_sha256 is distinct from current_deployment.deployment_sha256
      or new.prior_revision is distinct from current_deployment.revision
      or new.prior_generation is distinct from current_deployment.generation
      or new.revision <= current_deployment.revision or new.generation <= current_deployment.generation then
      raise exception 'replacement deployment must exactly chain from the active pointer with higher revision and generation';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.validate_publication_stream()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target private.deployments%rowtype;
  previous_target private.deployments%rowtype;
  authority_row private.publication_authorities%rowtype;
begin
  select * into strict target from private.deployments
    where tenant_id = new.tenant_id and id = new.active_deployment_id;
  if target.site_id <> new.site_id or target.environment <> new.environment then
    raise exception 'active pointer deployment scope mismatch';
  end if;
  select * into strict authority_row from private.publication_authorities
    where tenant_id = target.tenant_id and authority_id = target.authority_id and key_id = target.key_id;
  if authority_row.status <> 'active' or authority_row.revoked_at is not null then
    raise exception 'active pointer target authority must be active';
  end if;
  if tg_op = 'UPDATE' then
    select * into strict previous_target from private.deployments
      where tenant_id = old.tenant_id and id = old.active_deployment_id;
    if new.tenant_id <> old.tenant_id or new.site_id <> old.site_id or new.environment <> old.environment
      or new.active_deployment_id = old.active_deployment_id then
      raise exception 'publication stream may only advance its deployment pointer';
    end if;
    if target.prior_deployment_id is distinct from previous_target.id
      or target.prior_deployment_sha256 is distinct from previous_target.deployment_sha256
      or target.prior_revision is distinct from previous_target.revision
      or target.prior_generation is distinct from previous_target.generation
      or target.revision <= previous_target.revision or target.generation <= previous_target.generation then
      raise exception 'publication pointer target must exactly chain from the current active deployment';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.record_publication_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target private.deployments%rowtype;
  event_kind text;
begin
  select * into strict target from private.deployments
    where tenant_id = new.tenant_id and id = new.active_deployment_id;
  if tg_op = 'INSERT' then
    event_kind := 'activated';
  elsif exists (
    select 1
    from private.publication_events published
    join private.deployments earlier
      on earlier.tenant_id = published.tenant_id and earlier.id = published.deployment_id
    where published.tenant_id = target.tenant_id and published.site_id = target.site_id
      and published.environment = target.environment and earlier.id <> target.id
      and earlier.asset_version_id = target.asset_version_id and earlier.asset_version = target.asset_version
  ) then
    event_kind := 'rollback';
  else
    event_kind := 'replaced';
  end if;
  insert into private.publication_events (
    tenant_id, id, site_id, environment, event_type, deployment_id, prior_deployment_id,
    revision, generation, actor_subject_id, occurred_at, evidence_sha256
  ) values (
    target.tenant_id, target.id || ':' || event_kind, target.site_id, target.environment, event_kind,
    target.id, target.prior_deployment_id, target.revision, target.generation,
    target.actor_subject_id, target.activated_at, target.deployment_sha256
  );
  return new;
end;
$$;

create trigger measurement_evidence_geometry_before_insert before insert on private.measurement_evidence
  for each row execute function private.validate_measurement_evidence();
create trigger generation_event_chain_before_insert before insert on private.generation_job_events
  for each row execute function private.validate_generation_event_chain();
create trigger asset_version_update_before_update before update on private.asset_versions
  for each row execute function private.validate_asset_update();
create trigger asset_version_insert_before_insert before insert on private.asset_versions
  for each row execute function private.validate_asset_insert();
create trigger qa_decision_binding_before_insert before insert on private.qa_review_decisions
  for each row execute function private.validate_qa_decision();
create trigger publication_authority_update_before_update before update on private.publication_authorities
  for each row execute function private.validate_publication_authority_update();
create trigger deployment_lineage_before_insert before insert on private.deployments
  for each row execute function private.validate_deployment_insert();
create trigger publication_stream_before_write before insert or update on private.publication_streams
  for each row execute function private.validate_publication_stream();
create trigger publication_stream_event_after_write after insert or update on private.publication_streams
  for each row execute function private.record_publication_event();

create trigger source_assets_immutable before update or delete on private.source_assets for each row execute function private.reject_mutation();
create trigger measurement_sets_immutable before update or delete on private.measurement_sets for each row execute function private.reject_mutation();
create trigger measurement_evidence_append_only before update or delete on private.measurement_evidence for each row execute function private.reject_mutation();
create trigger generation_jobs_immutable before update or delete on private.generation_jobs for each row execute function private.reject_mutation();
create trigger generation_events_append_only before update or delete on private.generation_job_events for each row execute function private.reject_mutation();
create trigger asset_versions_no_delete before delete on private.asset_versions for each row execute function private.reject_mutation();
create trigger asset_sources_immutable before update or delete on private.asset_version_sources for each row execute function private.reject_mutation();
create trigger qa_decisions_append_only before update or delete on private.qa_review_decisions for each row execute function private.reject_mutation();
create trigger publication_authorities_no_delete before delete on private.publication_authorities for each row execute function private.reject_mutation();
create trigger publication_resources_immutable before update or delete on private.immutable_publication_resources for each row execute function private.reject_mutation();
create trigger deployments_append_only before update or delete on private.deployments for each row execute function private.reject_mutation();
create trigger publication_streams_no_delete before delete on private.publication_streams for each row execute function private.reject_mutation();
create trigger audit_events_append_only before update or delete on private.audit_events for each row execute function private.reject_mutation();
create trigger publication_events_append_only before update or delete on private.publication_events for each row execute function private.reject_mutation();

-- Defense in depth for all internal base tables. API views execute as the caller,
-- so these policies remain the tenant authorization boundary.
alter table private.tenants enable row level security; alter table private.tenants force row level security;
alter table private.tenant_memberships enable row level security; alter table private.tenant_memberships force row level security;
alter table private.sites enable row level security; alter table private.sites force row level security;
alter table private.frame_models enable row level security; alter table private.frame_models force row level security;
alter table private.frame_variants enable row level security; alter table private.frame_variants force row level security;
alter table private.source_assets enable row level security; alter table private.source_assets force row level security;
alter table private.measurement_sets enable row level security; alter table private.measurement_sets force row level security;
alter table private.measurement_evidence enable row level security; alter table private.measurement_evidence force row level security;
alter table private.generation_jobs enable row level security; alter table private.generation_jobs force row level security;
alter table private.generation_job_events enable row level security; alter table private.generation_job_events force row level security;
alter table private.asset_versions enable row level security; alter table private.asset_versions force row level security;
alter table private.asset_version_sources enable row level security; alter table private.asset_version_sources force row level security;
alter table private.qa_review_decisions enable row level security; alter table private.qa_review_decisions force row level security;
alter table private.publication_authorities enable row level security; alter table private.publication_authorities force row level security;
alter table private.immutable_publication_resources enable row level security; alter table private.immutable_publication_resources force row level security;
alter table private.deployments enable row level security; alter table private.deployments force row level security;
alter table private.publication_streams enable row level security; alter table private.publication_streams force row level security;
alter table private.audit_events enable row level security; alter table private.audit_events force row level security;
alter table private.publication_events enable row level security; alter table private.publication_events force row level security;

create policy tenant_member_read on private.tenants for select to authenticated using ((select private.is_tenant_member(id)));
create policy tenant_membership_member_read on private.tenant_memberships for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy site_member_read on private.sites for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy frame_model_member_read on private.frame_models for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy frame_variant_member_read on private.frame_variants for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy source_asset_member_read on private.source_assets for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy measurement_set_member_read on private.measurement_sets for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy measurement_evidence_member_read on private.measurement_evidence for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy generation_job_member_read on private.generation_jobs for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy generation_event_member_read on private.generation_job_events for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy asset_version_member_read on private.asset_versions for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy asset_source_member_read on private.asset_version_sources for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy qa_decision_member_read on private.qa_review_decisions for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy authority_member_read on private.publication_authorities for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy publication_resource_member_read on private.immutable_publication_resources for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy deployment_member_read on private.deployments for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy publication_stream_member_read on private.publication_streams for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy audit_event_member_read on private.audit_events for select to authenticated using ((select private.is_tenant_member(tenant_id)));
create policy publication_event_member_read on private.publication_events for select to authenticated using ((select private.is_tenant_member(tenant_id)));

create view api.asset_review_queue with (security_invoker = true) as
select job.tenant_id, job.id as generation_job_id, job.frame_model_id, model.model_code,
  job.method, job.generator_id, job.generator_version, job.canonical_input_sha256,
  job.generator_input_sha256, 'review'::text as status, job.created_at
from private.generation_jobs job
join private.frame_models model on model.tenant_id = job.tenant_id and model.id = job.frame_model_id
join lateral (
  select event.event_type
  from private.generation_job_events event
  where event.tenant_id = job.tenant_id and event.generation_job_id = job.id
  order by event.sequence desc
  limit 1
) head on true
where head.event_type = 'output-recorded';

create view api.qa_review_decisions with (security_invoker = true) as
select tenant_id, id, frame_model_id, generation_job_id, sequence, reviewer_subject_id,
  decision, issue_categories, notes, decision_sha256, reviewed_at, evaluated_at
from private.qa_review_decisions;

revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all tables in schema api from public, anon, authenticated, service_role;
grant select on private.generation_jobs, private.generation_job_events, private.frame_models, private.qa_review_decisions to authenticated;
grant select on api.asset_review_queue, api.qa_review_decisions to authenticated;

revoke execute on function private.reject_mutation() from public, anon, authenticated, service_role;
revoke execute on function private.validate_measurement_evidence() from public, anon, authenticated, service_role;
revoke execute on function private.validate_generation_event_chain() from public, anon, authenticated, service_role;
revoke execute on function private.validate_asset_update() from public, anon, authenticated, service_role;
revoke execute on function private.validate_asset_insert() from public, anon, authenticated, service_role;
revoke execute on function private.validate_qa_decision() from public, anon, authenticated, service_role;
revoke execute on function private.validate_publication_authority_update() from public, anon, authenticated, service_role;
revoke execute on function private.validate_deployment_insert() from public, anon, authenticated, service_role;
revoke execute on function private.validate_publication_stream() from public, anon, authenticated, service_role;
revoke execute on function private.record_publication_event() from public, anon, authenticated, service_role;
