-- JSC-0218 non-Proxy QA control-plane persistence v2.
-- Data-free, private-schema-only, and forward-only. SQL deliberately does not
-- verify ES256; a future trusted adapter must re-evaluate JSC-0215 and supply
-- canonical row projections. These constraints enforce relational truth only.

do $$
begin
  if exists (select 1 from private.asset_versions where quality in ('standard','premium') and status in ('approved','published')) then
    raise exception 'v2 requires a data-free cutover: unexpected pre-v2 standard/premium approved or published AssetVersion exists';
  end if;
end;
$$;

alter table private.source_assets
  add constraint source_assets_exact_identity_unique
  unique (tenant_id, id, frame_model_id, sha256);

alter table private.measurement_sets
  add constraint measurement_sets_exact_identity_unique
  unique (tenant_id, id, frame_model_id, evidence_sha256);

alter table private.asset_version_sources
  add column frame_variant_id private.identifier,
  add column persistence_source_row_id private.identifier,
  add column persistence_source_row_sha256 private.sha256,
  add constraint asset_version_sources_persistence_id_unique unique (tenant_id, persistence_source_row_id),
  add constraint asset_version_sources_persistence_sha_unique unique (tenant_id, persistence_source_row_sha256),
  add constraint asset_version_sources_exact_source_fkey
    foreign key (tenant_id, source_asset_id, frame_model_id, source_sha256)
    references private.source_assets(tenant_id, id, frame_model_id, sha256),
  add constraint asset_version_sources_variant_fkey
    foreign key (tenant_id, frame_variant_id, frame_model_id)
    references private.frame_variants(tenant_id, id, frame_model_id);

alter table private.asset_versions
  add column frame_variant_id private.identifier,
  add column non_proxy_internal_review boolean not null default false,
  add column rights_scope text,
  add column recommended_for_live boolean not null default false,
  add column publication_eligible boolean not null default true,
  add column persistence_row_sha256 private.sha256,
  add column fixture_status text,
  add column review_status text,
  add column admission text,
  add column promotable boolean,
  add constraint asset_versions_persistence_row_sha_unique unique (tenant_id, persistence_row_sha256),
  add constraint asset_versions_exact_variant_identity_unique unique (tenant_id, id, frame_model_id, frame_variant_id),
  add constraint asset_versions_variant_exact_fkey
    foreign key (tenant_id, frame_variant_id, frame_model_id)
    references private.frame_variants(tenant_id, id, frame_model_id),
  add constraint asset_versions_non_proxy_classification_check check (
    (not non_proxy_internal_review)
    or (quality in ('standard', 'premium')
      and frame_variant_id is not null
      and rights_scope is not null
      and rights_scope = 'internal-review-only'
      and recommended_for_live = false
      and publication_eligible = false
      and persistence_row_sha256 is not null
      and fixture_status = 'unverified'
      and fixture_status is not null
      and review_status = 'approved'
      and review_status is not null
      and admission = 'internal-review-only'
      and admission is not null
      and promotable = false
      and promotable is not null
      and status in ('review', 'approved', 'retired'))
  );

alter table private.asset_version_sources
  add constraint asset_version_sources_exact_asset_variant_fkey
  foreign key (tenant_id, asset_version_id, frame_model_id, frame_variant_id)
  references private.asset_versions(tenant_id, id, frame_model_id, frame_variant_id);

create table private.qa_reviewer_authorities (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  row_sha256 private.sha256 not null,
  authority_id private.identifier not null,
  key_id private.identifier not null,
  reviewer_id private.identifier not null,
  scope text not null check (scope = 'non-proxy-human-qa-decision'),
  algorithm text not null check (algorithm = 'ES256'),
  public_key_fingerprint_sha256 private.sha256 not null,
  public_jwk jsonb not null check (
    jsonb_typeof(public_jwk) = 'object'
    and public_jwk ?& array['key_ops','ext','kty','x','y','crv','use','alg']
    and public_jwk - 'key_ops' - 'ext' - 'kty' - 'x' - 'y' - 'crv' - 'use' - 'alg' = '{}'::jsonb
    and public_jwk->'key_ops' = '["verify"]'::jsonb
    and public_jwk->'ext' = 'true'::jsonb
    and jsonb_typeof(public_jwk->'kty') = 'string' and jsonb_typeof(public_jwk->'crv') = 'string'
    and jsonb_typeof(public_jwk->'use') = 'string' and jsonb_typeof(public_jwk->'alg') = 'string'
    and jsonb_typeof(public_jwk->'x') = 'string' and jsonb_typeof(public_jwk->'y') = 'string'
    and public_jwk->>'kty' = 'EC' and public_jwk->>'crv' = 'P-256'
    and public_jwk->>'use' = 'sig' and public_jwk->>'alg' = 'ES256'
    and public_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$' and public_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  status text not null check (status in ('active', 'revoked')),
  created_at timestamptz not null,
  revoked_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, row_sha256),
  unique (tenant_id, authority_id, key_id),
  unique (tenant_id, authority_id, key_id, reviewer_id, public_key_fingerprint_sha256),
  unique (tenant_id, id, authority_id, key_id, reviewer_id, public_key_fingerprint_sha256),
  unique (tenant_id, public_key_fingerprint_sha256),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (revoked_at is null or revoked_at >= created_at),
  check (id = 'nqra_' || row_sha256)
);

create table private.non_proxy_human_qa_records (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  row_sha256 private.sha256 not null,
  frame_model_id private.identifier not null,
  frame_variant_id private.identifier not null,
  candidate_asset_version_id private.identifier not null,
  candidate_version integer not null check (candidate_version > 0),
  generation_job_id private.identifier not null,
  canonical_input_sha256 private.sha256 not null,
  review_head_event_sha256 private.sha256 not null,
  generator_input_sha256 private.sha256 not null,
  manifest_sha256 private.sha256 not null,
  manifest_byte_length bigint not null check (manifest_byte_length > 0),
  model_sha256 private.sha256 not null,
  model_byte_length bigint not null check (model_byte_length > 0),
  source_asset_sha256s private.sha256[] not null,
  source_set_sha256 private.sha256 not null,
  measurement_set_id private.identifier not null,
  measurement_set_sha256 private.sha256 not null,
  specimen_id private.identifier not null,
  composition jsonb not null check (jsonb_typeof(composition) = 'object'),
  signed_schema_version integer not null check (signed_schema_version = 1),
  signed_type text not null check (signed_type = 'non-proxy-human-qa-decision-attestation'),
  signed_algorithm text not null check (signed_algorithm = 'ES256'),
  signed_scope text not null check (signed_scope = 'non-proxy-human-qa-decision'),
  decision_payload_sha256 private.sha256 not null,
  signature_base64 text not null check (length(signature_base64) = 88 and signature_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  signed_payload jsonb not null check (jsonb_typeof(signed_payload) = 'object'),
  reviewer_authority_row_id private.identifier not null,
  reviewer_authority_id private.identifier not null,
  reviewer_key_id private.identifier not null,
  reviewer_id private.identifier not null,
  reviewer_public_key_fingerprint_sha256 private.sha256 not null,
  decision text not null check (decision in ('approve', 'reject')),
  issue_categories text[] not null,
  notes text check (length(notes) between 1 and 2000 and notes = btrim(notes)),
  approved_quality_envelope jsonb,
  approved_quality text,
  approved_generation_method text,
  approved_model_url private.https_url,
  approved_manifest_url private.https_url,
  approved_attachment_matrix jsonb,
  approved_fixture_status text,
  approved_review_status text,
  approved_admission text,
  approved_promotable boolean,
  reviewed_at timestamptz not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  input_valid_until timestamptz not null,
  maximum_review_age_ms bigint not null check (maximum_review_age_ms between 1 and 31622400000),
  review_fresh_until timestamptz not null,
  review_policy_sha256 private.sha256 not null,
  effective_valid_until timestamptz not null,
  approved_asset_version_row_sha256 private.sha256,
  rights_scope text not null check (rights_scope = 'internal-review-only'),
  terminal boolean not null check (terminal),
  primary key (tenant_id, id),
  unique (tenant_id, row_sha256),
  unique (tenant_id, decision_payload_sha256),
  unique (tenant_id, candidate_asset_version_id, candidate_version, generation_job_id),
  unique (tenant_id, id, decision_payload_sha256, effective_valid_until),
  foreign key (tenant_id, frame_model_id) references private.frame_models(tenant_id, id),
  foreign key (tenant_id, frame_variant_id, frame_model_id) references private.frame_variants(tenant_id, id, frame_model_id),
  foreign key (tenant_id, generation_job_id, frame_model_id) references private.generation_jobs(tenant_id, id, frame_model_id),
  foreign key (tenant_id, measurement_set_id, frame_model_id, measurement_set_sha256)
    references private.measurement_sets(tenant_id, id, frame_model_id, evidence_sha256),
  foreign key (tenant_id, reviewer_authority_row_id, reviewer_authority_id, reviewer_key_id, reviewer_id, reviewer_public_key_fingerprint_sha256)
    references private.qa_reviewer_authorities(tenant_id, id, authority_id, key_id, reviewer_id, public_key_fingerprint_sha256),
  check (cardinality(source_asset_sha256s) between 1 and 32),
  check ((decision = 'approve' and cardinality(issue_categories) = 0 and approved_quality_envelope is not null)
    or (decision = 'reject' and cardinality(issue_categories) > 0 and approved_quality_envelope is null)),
  check (reviewed_at <= issued_at and issued_at < expires_at),
  check (review_fresh_until = reviewed_at + maximum_review_age_ms * interval '1 millisecond'),
  check (effective_valid_until = least(expires_at, input_valid_until, review_fresh_until)),
  check ((decision = 'approve' and approved_asset_version_row_sha256 is not null
    and approved_quality is not null and approved_quality in ('standard','premium')
    and approved_generation_method is not null and approved_generation_method in ('standard-auto','manual','external')
    and approved_model_url is not null and approved_manifest_url is not null
    and approved_attachment_matrix is not null and jsonb_typeof(approved_attachment_matrix) = 'array' and jsonb_array_length(approved_attachment_matrix) = 16
    and approved_fixture_status is not null and approved_fixture_status = 'unverified'
    and approved_review_status is not null and approved_review_status = 'approved'
    and approved_admission is not null and approved_admission = 'internal-review-only'
    and approved_promotable is not null and approved_promotable = false)
    or (decision = 'reject' and approved_asset_version_row_sha256 is null and approved_quality is null
      and approved_generation_method is null and approved_model_url is null and approved_manifest_url is null
      and approved_attachment_matrix is null and approved_fixture_status is null and approved_review_status is null
      and approved_admission is null and approved_promotable is null)),
  check (approved_quality_envelope is null or (
    jsonb_typeof(approved_quality_envelope) = 'object'
    and jsonb_typeof(approved_quality_envelope->'recommendedForLive') = 'boolean'
    and approved_quality_envelope->'recommendedForLive' = 'false'::jsonb
    and jsonb_typeof(approved_quality_envelope->'scaleConfidence') = 'string'
    and approved_quality_envelope->>'scaleConfidence' in ('low', 'medium', 'high')
    and approved_quality_envelope ?& array['maxYawDeg','maxPitchDeg','recommendedForLive','scaleConfidence']
    and approved_quality_envelope - 'maxYawDeg' - 'maxPitchDeg' - 'recommendedForLive' - 'scaleConfidence' = '{}'::jsonb
    and jsonb_typeof(approved_quality_envelope->'maxYawDeg') = 'number'
    and (approved_quality_envelope->>'maxYawDeg')::numeric between 0 and 90
    and jsonb_typeof(approved_quality_envelope->'maxPitchDeg') = 'number'
    and (approved_quality_envelope->>'maxPitchDeg')::numeric between 0 and 90
  ))
);

create table private.non_proxy_asset_version_bindings (
  tenant_id private.identifier not null references private.tenants(id),
  id private.identifier not null,
  row_sha256 private.sha256 not null,
  review_record_id private.identifier not null,
  decision_payload_sha256 private.sha256 not null,
  effective_valid_until timestamptz not null,
  asset_version_row_sha256 private.sha256 not null,
  asset_version_id private.identifier not null,
  frame_model_id private.identifier not null,
  frame_variant_id private.identifier not null,
  generation_job_id private.identifier not null,
  source_set_sha256 private.sha256 not null,
  quality_envelope jsonb not null check (jsonb_typeof(quality_envelope) = 'object'),
  rights_scope text not null check (rights_scope = 'internal-review-only'),
  recommended_for_live boolean not null check (recommended_for_live = false),
  publication_eligible boolean not null check (publication_eligible = false),
  primary key (tenant_id, id),
  unique (tenant_id, row_sha256),
  unique (tenant_id, review_record_id),
  unique (tenant_id, asset_version_id),
  foreign key (tenant_id, review_record_id, decision_payload_sha256, effective_valid_until)
    references private.non_proxy_human_qa_records(tenant_id, id, decision_payload_sha256, effective_valid_until),
  foreign key (tenant_id, asset_version_id, frame_model_id)
    references private.asset_versions(tenant_id, id, frame_model_id),
  foreign key (tenant_id, frame_variant_id, frame_model_id)
    references private.frame_variants(tenant_id, id, frame_model_id),
  foreign key (tenant_id, generation_job_id, frame_model_id)
    references private.generation_jobs(tenant_id, id, frame_model_id),
  check (id = 'nqab_' || row_sha256),
  check (quality_envelope ?& array['maxYawDeg','maxPitchDeg','recommendedForLive','scaleConfidence']
    and quality_envelope - 'maxYawDeg' - 'maxPitchDeg' - 'recommendedForLive' - 'scaleConfidence' = '{}'::jsonb
    and jsonb_typeof(quality_envelope->'recommendedForLive') = 'boolean'
    and quality_envelope->'recommendedForLive' = 'false'::jsonb
    and jsonb_typeof(quality_envelope->'scaleConfidence') = 'string'
    and quality_envelope->>'scaleConfidence' in ('low','medium','high')
    and jsonb_typeof(quality_envelope->'maxYawDeg') = 'number'
    and (quality_envelope->>'maxYawDeg')::numeric between 0 and 90
    and jsonb_typeof(quality_envelope->'maxPitchDeg') = 'number'
    and (quality_envelope->>'maxPitchDeg')::numeric between 0 and 90)
);

create or replace function private.validate_non_proxy_reviewer_authority_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status' - 'revoked_at') is distinct from (to_jsonb(old) - 'status' - 'revoked_at') then
    raise exception 'reviewer authority identity and public key are immutable';
  end if;
  if old.status <> 'active' or old.revoked_at is not null or new.status <> 'revoked'
    or new.revoked_at is null or new.revoked_at < old.created_at then
    raise exception 'reviewer authority may only transition once from active to revoked';
  end if;
  return new;
end;
$$;

create or replace function private.validate_non_proxy_human_qa_record()
returns trigger language plpgsql set search_path = '' as $$
declare
  job private.generation_jobs%rowtype;
  head private.generation_job_events%rowtype;
  authority private.qa_reviewer_authorities%rowtype;
  measurement private.measurement_sets%rowtype;
  sorted_issues text[];
  sorted_sources private.sha256[];
begin
  select * into strict job from private.generation_jobs
    where tenant_id = new.tenant_id and id = new.generation_job_id and frame_model_id = new.frame_model_id for update;
  select * into strict head from private.generation_job_events
    where tenant_id = new.tenant_id and generation_job_id = new.generation_job_id
    order by sequence desc limit 1;
  select * into strict authority from private.qa_reviewer_authorities
    where tenant_id = new.tenant_id and id = new.reviewer_authority_row_id for share;
  select * into strict measurement from private.measurement_sets
    where tenant_id = new.tenant_id and id = new.measurement_set_id
      and frame_model_id = new.frame_model_id and evidence_sha256 = new.measurement_set_sha256 for share;
  if job.canonical_input_sha256 <> new.canonical_input_sha256
    or job.generator_input_sha256 <> new.generator_input_sha256
    or head.event_type <> 'output-recorded' or head.event_sha256 <> new.review_head_event_sha256 then
    raise exception 'non-Proxy terminal review must bind exact GenerationJob and current output head';
  end if;
  if measurement.status <> 'verified' then raise exception 'non-Proxy terminal review requires a verified MeasurementSet'; end if;
  if authority.status <> 'active' or authority.revoked_at is not null
    or authority.created_at > new.reviewed_at
    or authority.authority_id <> new.reviewer_authority_id or authority.key_id <> new.reviewer_key_id
    or authority.reviewer_id <> new.reviewer_id
    or authority.public_key_fingerprint_sha256 <> new.reviewer_public_key_fingerprint_sha256 then
    raise exception 'non-Proxy terminal review authority must be exact, active, and pre-existing';
  end if;
  if new.review_fresh_until is distinct from new.reviewed_at + new.maximum_review_age_ms * interval '1 millisecond'
    or new.effective_valid_until <= now()
    or new.effective_valid_until is distinct from least(new.expires_at,new.input_valid_until,new.review_fresh_until) then
    raise exception 'non-Proxy terminal review is expired or has an inexact policy horizon';
  end if;
  if new.input_valid_until is distinct from (new.composition->>'inputValidUntil')::timestamptz
    or octet_length(decode(new.signature_base64, 'base64')) <> 64
    or replace(replace(encode(decode(new.signature_base64, 'base64'), 'base64'), E'\n', ''), E'\r', '') <> new.signature_base64 then
    raise exception 'non-Proxy composition horizon or canonical ES256 signature bytes are invalid';
  end if;
  if new.approved_attachment_matrix is not null and exists (
    select 1 from jsonb_array_elements(new.approved_attachment_matrix) element where jsonb_typeof(element) <> 'number'
  ) then raise exception 'approved attachment matrix must contain exactly 16 finite JSON numbers'; end if;
  select coalesce(array_agg(issue order by issue), '{}'::text[]) into sorted_issues from unnest(new.issue_categories) issue;
  if new.issue_categories is distinct from sorted_issues
    or not (new.issue_categories <@ array['geometry','dimensions','attachment','materials','visual-fidelity','actual-wear','physical-evidence','rights','provenance','unsupported']::text[]) then
    raise exception 'non-Proxy terminal review issues must be known, unique, and sorted';
  end if;
  if cardinality(new.issue_categories) <> (select count(distinct issue) from unnest(new.issue_categories) issue) then
    raise exception 'non-Proxy terminal review issues must be unique';
  end if;
  select array_agg(source order by source) into sorted_sources from unnest(new.source_asset_sha256s) source;
  if new.source_asset_sha256s is distinct from sorted_sources
    or cardinality(new.source_asset_sha256s) <> (select count(distinct source) from unnest(new.source_asset_sha256s) source) then
    raise exception 'non-Proxy source hashes must be unique and sorted';
  end if;
  if (new.signed_payload->>'schemaVersion')::integer is distinct from new.signed_schema_version
    or new.signed_payload->>'type' is distinct from new.signed_type
    or new.signed_payload->>'algorithm' is distinct from new.signed_algorithm
    or new.signed_payload->>'scope' is distinct from new.signed_scope
    or new.signed_payload->>'tenantId' is distinct from new.tenant_id::text
    or new.signed_payload->>'frameModelId' is distinct from new.frame_model_id::text
    or new.signed_payload->>'frameVariantId' is distinct from new.frame_variant_id::text
    or new.signed_payload->>'candidateId' is distinct from new.candidate_asset_version_id::text
    or (new.signed_payload->>'candidateVersion')::integer is distinct from new.candidate_version
    or new.signed_payload->>'jobId' is distinct from new.generation_job_id::text
    or new.signed_payload->>'canonicalInputSha256' is distinct from new.canonical_input_sha256::text
    or new.signed_payload->>'reviewHeadEventSha256' is distinct from new.review_head_event_sha256::text
    or new.signed_payload->>'generatorInputSha256' is distinct from new.generator_input_sha256::text
    or new.signed_payload->>'measurementSetSha256' is distinct from new.measurement_set_sha256::text
    or new.signed_payload->>'specimenId' is distinct from new.specimen_id::text
    or new.signed_payload->>'authorityId' is distinct from new.reviewer_authority_id::text
    or new.signed_payload->>'keyId' is distinct from new.reviewer_key_id::text
    or new.signed_payload->>'reviewerId' is distinct from new.reviewer_id::text
    or new.signed_payload->>'publicKeyFingerprintSha256' is distinct from new.reviewer_public_key_fingerprint_sha256::text
    or new.signed_payload->>'decision' is distinct from new.decision
    or new.signed_payload->>'rightsScope' is distinct from new.rights_scope
    or new.signed_payload->'output' is distinct from jsonb_build_object('manifestSha256',new.manifest_sha256,'modelSha256',new.model_sha256,'manifestByteLength',new.manifest_byte_length,'modelByteLength',new.model_byte_length)
    or new.signed_payload->'sourceAssetSha256s' is distinct from to_jsonb(new.source_asset_sha256s)
    or new.signed_payload->'composition' is distinct from new.composition
    or new.signed_payload->'issueCategories' is distinct from to_jsonb(new.issue_categories)
    or new.signed_payload->'approvedQualityEnvelope' is distinct from coalesce(new.approved_quality_envelope, 'null'::jsonb)
    or new.signed_payload->'notes' is distinct from coalesce(to_jsonb(new.notes), 'null'::jsonb)
    or (new.signed_payload->>'reviewedAt')::timestamptz is distinct from new.reviewed_at
    or (new.signed_payload->>'issuedAt')::timestamptz is distinct from new.issued_at
    or (new.signed_payload->>'expiresAt')::timestamptz is distinct from new.expires_at
    or new.signed_payload - 'schemaVersion' - 'type' - 'algorithm' - 'scope' - 'authorityId' - 'keyId'
      - 'publicKeyFingerprintSha256' - 'reviewerId' - 'tenantId' - 'frameModelId' - 'frameVariantId'
      - 'candidateId' - 'candidateVersion' - 'jobId' - 'canonicalInputSha256' - 'reviewHeadEventSha256'
      - 'generatorInputSha256' - 'output' - 'sourceAssetSha256s' - 'measurementSetSha256' - 'specimenId'
      - 'composition' - 'rightsScope' - 'decision' - 'issueCategories' - 'notes' - 'approvedQualityEnvelope'
      - 'reviewedAt' - 'issuedAt' - 'expiresAt' <> '{}'::jsonb then
    raise exception 'signed terminal payload columns must remain exact';
  end if;
  return new;
exception when invalid_text_representation then
  raise exception 'signed terminal payload columns must remain exact';
end;
$$;

create or replace function private.validate_non_proxy_binding()
returns trigger language plpgsql set search_path = '' as $$
declare
  review private.non_proxy_human_qa_records%rowtype;
  asset private.asset_versions%rowtype;
  authority private.qa_reviewer_authorities%rowtype;
  job private.generation_jobs%rowtype;
  head private.generation_job_events%rowtype;
  actual_sources private.sha256[];
begin
  select * into strict review from private.non_proxy_human_qa_records where tenant_id = new.tenant_id and id = new.review_record_id for share;
  select * into strict asset from private.asset_versions where tenant_id = new.tenant_id and id = new.asset_version_id for update;
  select * into strict authority from private.qa_reviewer_authorities where tenant_id = review.tenant_id and id = review.reviewer_authority_row_id for share;
  select * into strict job from private.generation_jobs where tenant_id = review.tenant_id and id = review.generation_job_id for update;
  select * into strict head from private.generation_job_events where tenant_id = review.tenant_id and generation_job_id = review.generation_job_id order by sequence desc limit 1;
  if head.event_type is distinct from 'output-recorded' or head.event_sha256 is distinct from review.review_head_event_sha256 then
    raise exception 'non-Proxy binding review head is no longer current';
  end if;
  select array_agg(source_sha256 order by source_sha256) into actual_sources from private.asset_version_sources
    where tenant_id = new.tenant_id and asset_version_id = new.asset_version_id;
  if review.decision is distinct from 'approve' or review.effective_valid_until <= now() or authority.status is distinct from 'active' or authority.revoked_at is not null
    or review.decision_payload_sha256 is distinct from new.decision_payload_sha256 or review.effective_valid_until is distinct from new.effective_valid_until
    or review.candidate_asset_version_id is distinct from asset.id or review.candidate_version is distinct from asset.version
    or review.frame_model_id is distinct from new.frame_model_id or review.frame_variant_id is distinct from new.frame_variant_id
    or review.generation_job_id is distinct from new.generation_job_id or review.source_set_sha256 is distinct from new.source_set_sha256
    or review.source_asset_sha256s is distinct from actual_sources
    or review.manifest_sha256 is distinct from asset.manifest_sha256 or review.manifest_byte_length is distinct from asset.manifest_byte_length
    or review.model_sha256 is distinct from asset.model_sha256 or review.model_byte_length is distinct from asset.model_byte_length
    or review.approved_asset_version_row_sha256 is distinct from asset.persistence_row_sha256
    or new.asset_version_row_sha256 is distinct from asset.persistence_row_sha256
    or review.approved_quality is distinct from asset.quality or review.approved_generation_method is distinct from asset.generation_method
    or review.approved_model_url is distinct from asset.model_url or review.approved_manifest_url is distinct from asset.manifest_url
    or review.approved_attachment_matrix is distinct from asset.attachment_matrix
    or review.approved_fixture_status is distinct from asset.fixture_status or review.approved_review_status is distinct from asset.review_status
    or review.approved_admission is distinct from asset.admission or review.approved_promotable is distinct from asset.promotable
    or review.approved_quality_envelope is distinct from new.quality_envelope or asset.quality_envelope is distinct from new.quality_envelope
    or not asset.non_proxy_internal_review or asset.status <> 'review'
    or asset.recommended_for_live or asset.publication_eligible
    or asset.rights_scope is distinct from 'internal-review-only' then
    raise exception 'non-Proxy binding must exactly bind one unexpired approve record, asset, sources, output, envelope, and rights';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_version_source_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  asset private.asset_versions%rowtype;
  source private.source_assets%rowtype;
begin
  select * into strict asset from private.asset_versions
    where tenant_id = new.tenant_id and id = new.asset_version_id and frame_model_id = new.frame_model_id for share;
  select * into strict source from private.source_assets
    where tenant_id = new.tenant_id and id = new.source_asset_id and frame_model_id = new.frame_model_id and sha256 = new.source_sha256 for share;
  if asset.non_proxy_internal_review then
    if new.frame_variant_id is distinct from asset.frame_variant_id
      or new.persistence_source_row_id is null or new.persistence_source_row_sha256 is null then
      raise exception 'internal non-Proxy source row requires exact variant and immutable projection identity/digest';
    end if;
    if new.persistence_source_row_id is distinct from ('nqas_' || new.persistence_source_row_sha256) then
      raise exception 'internal non-Proxy source row identity must derive from its exact digest';
    end if;
    if source.frame_variant_id is not null and source.frame_variant_id is distinct from asset.frame_variant_id then
      raise exception 'source variant must be model-wide or exactly match the internal non-Proxy asset variant';
    end if;
  elsif new.frame_variant_id is not null or new.persistence_source_row_id is not null or new.persistence_source_row_sha256 is not null then
    raise exception 'ordinary source rows cannot claim non-Proxy persistence identity';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  review private.non_proxy_human_qa_records%rowtype;
  authority private.qa_reviewer_authorities%rowtype;
  job private.generation_jobs%rowtype;
  head private.generation_job_events%rowtype;
begin
  if new.non_proxy_internal_review then
    if new.status <> 'review' then raise exception 'internal non-Proxy asset must enter review'; end if;
    select * into strict review from private.non_proxy_human_qa_records
      where tenant_id = new.tenant_id and candidate_asset_version_id = new.id
        and candidate_version = new.version and generation_job_id = new.generation_job_id for share;
    select * into strict authority from private.qa_reviewer_authorities where tenant_id = review.tenant_id and id = review.reviewer_authority_row_id for share;
    select * into strict job from private.generation_jobs where tenant_id = review.tenant_id and id = review.generation_job_id for update;
    select * into strict head from private.generation_job_events where tenant_id = review.tenant_id and generation_job_id = review.generation_job_id order by sequence desc limit 1;
    if review.decision is distinct from 'approve' or authority.status is distinct from 'active' or authority.revoked_at is not null
      or head.event_type is distinct from 'output-recorded' or head.event_sha256 is distinct from review.review_head_event_sha256
      or review.frame_model_id is distinct from new.frame_model_id
      or review.frame_variant_id is distinct from new.frame_variant_id or review.manifest_sha256 is distinct from new.manifest_sha256
      or review.manifest_byte_length is distinct from new.manifest_byte_length or review.model_sha256 is distinct from new.model_sha256
      or review.model_byte_length is distinct from new.model_byte_length or review.source_set_sha256 is distinct from new.source_set_sha256
      or review.approved_quality_envelope is distinct from new.quality_envelope or review.effective_valid_until <= now()
      or review.approved_asset_version_row_sha256 is distinct from new.persistence_row_sha256
      or review.approved_quality is distinct from new.quality or review.approved_generation_method is distinct from new.generation_method
      or review.approved_model_url is distinct from new.model_url or review.approved_manifest_url is distinct from new.manifest_url
      or review.approved_attachment_matrix is distinct from new.attachment_matrix
      or review.approved_fixture_status is distinct from new.fixture_status or review.approved_review_status is distinct from new.review_status
      or review.approved_admission is distinct from new.admission or review.approved_promotable is distinct from new.promotable then
      raise exception 'internal non-Proxy asset requires one exact unexpired approve record';
    end if;
  elsif new.status <> 'draft' then
    raise exception 'new asset versions must enter as draft';
  end if;
  return new;
end;
$$;

create or replace function private.validate_asset_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  exact_binding private.non_proxy_asset_version_bindings%rowtype;
  exact_review private.non_proxy_human_qa_records%rowtype;
  exact_authority private.qa_reviewer_authorities%rowtype;
  job private.generation_jobs%rowtype;
  head private.generation_job_events%rowtype;
begin
  if old.status in ('published', 'retired') then raise exception 'published or retired asset is immutable'; end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then raise exception 'asset identity, version, URLs, hashes, provenance, and geometry are immutable'; end if;
  if not ((old.status = 'draft' and new.status in ('review', 'retired')) or (old.status = 'review' and new.status in ('approved', 'retired')) or (old.status = 'approved' and new.status in ('published', 'retired'))) then raise exception 'invalid asset status transition'; end if;
  if old.quality = 'proxy' and new.status in ('approved', 'published') then raise exception 'proxy assets are non-promotable'; end if;
  if new.status = 'approved' and old.quality in ('standard','premium') then
    select * into strict exact_binding from private.non_proxy_asset_version_bindings where tenant_id = old.tenant_id and asset_version_id = old.id for share;
    select * into strict exact_review from private.non_proxy_human_qa_records where tenant_id = exact_binding.tenant_id and id = exact_binding.review_record_id for share;
    select * into strict exact_authority from private.qa_reviewer_authorities where tenant_id = exact_review.tenant_id and id = exact_review.reviewer_authority_row_id for share;
    select * into strict job from private.generation_jobs where tenant_id = exact_review.tenant_id and id = exact_review.generation_job_id for update;
    select * into strict head from private.generation_job_events where tenant_id = exact_review.tenant_id and generation_job_id = exact_review.generation_job_id order by sequence desc limit 1;
    if exact_review.decision <> 'approve' or exact_review.effective_valid_until <= now()
      or exact_authority.status <> 'active' or exact_authority.revoked_at is not null
      or head.event_type <> 'output-recorded' or head.event_sha256 <> exact_review.review_head_event_sha256 then
      raise exception 'standard or premium approval requires one exact current unexpired non-Proxy approve binding and active authority';
    end if;
  end if;
  if old.non_proxy_internal_review and new.status = 'published' then raise exception 'internal-review-only non-Proxy assets can never publish'; end if;
  return new;
end;
$$;

-- Serialize all GenerationJob head changes with both legacy and JSC-0218 review insertion.
create or replace function private.validate_generation_event_chain()
returns trigger language plpgsql set search_path = '' as $$
declare prior private.generation_job_events%rowtype;
begin
  perform 1 from private.generation_jobs where tenant_id = new.tenant_id and id = new.generation_job_id for update;
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

create or replace function private.validate_qa_decision()
returns trigger language plpgsql set search_path = '' as $$
declare
  job private.generation_jobs%rowtype;
  review_head private.generation_job_events%rowtype;
  prior private.qa_review_decisions%rowtype;
begin
  select * into strict job from private.generation_jobs
    where tenant_id = new.tenant_id and id = new.generation_job_id and frame_model_id = new.frame_model_id for update;
  select * into strict review_head from private.generation_job_events
    where tenant_id = new.tenant_id and generation_job_id = new.generation_job_id order by sequence desc limit 1;
  if new.canonical_input_sha256 <> job.canonical_input_sha256 or new.generator_input_sha256 <> job.generator_input_sha256
    or review_head.event_type <> 'output-recorded' or new.review_head_event_sha256 <> review_head.event_sha256 then
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

create trigger non_proxy_reviewer_authority_update_before_update before update on private.qa_reviewer_authorities for each row execute function private.validate_non_proxy_reviewer_authority_update();
create trigger non_proxy_reviewer_authorities_no_delete before delete on private.qa_reviewer_authorities for each row execute function private.reject_mutation();
create trigger non_proxy_human_qa_record_before_insert before insert on private.non_proxy_human_qa_records for each row execute function private.validate_non_proxy_human_qa_record();
create trigger non_proxy_human_qa_records_immutable before update or delete on private.non_proxy_human_qa_records for each row execute function private.reject_mutation();
create trigger non_proxy_binding_before_insert before insert on private.non_proxy_asset_version_bindings for each row execute function private.validate_non_proxy_binding();
create trigger non_proxy_bindings_immutable before update or delete on private.non_proxy_asset_version_bindings for each row execute function private.reject_mutation();
create trigger non_proxy_asset_source_before_insert before insert on private.asset_version_sources for each row execute function private.validate_asset_version_source_insert();

alter table private.qa_reviewer_authorities enable row level security; alter table private.qa_reviewer_authorities force row level security;
alter table private.non_proxy_human_qa_records enable row level security; alter table private.non_proxy_human_qa_records force row level security;
alter table private.non_proxy_asset_version_bindings enable row level security; alter table private.non_proxy_asset_version_bindings force row level security;

create index qa_reviewer_authorities_lookup_idx on private.qa_reviewer_authorities(tenant_id, authority_id, key_id, status);
create index non_proxy_human_qa_terminal_lookup_idx on private.non_proxy_human_qa_records(tenant_id, candidate_asset_version_id, candidate_version, generation_job_id);
create index non_proxy_human_qa_authority_idx on private.non_proxy_human_qa_records(tenant_id, reviewer_authority_row_id);
create index non_proxy_human_qa_job_idx on private.non_proxy_human_qa_records(tenant_id, generation_job_id, review_head_event_sha256);
create index non_proxy_human_qa_variant_idx on private.non_proxy_human_qa_records(tenant_id, frame_variant_id, frame_model_id);
create index non_proxy_human_qa_measurement_idx on private.non_proxy_human_qa_records(tenant_id, measurement_set_id, frame_model_id, measurement_set_sha256);
create index non_proxy_asset_binding_review_idx on private.non_proxy_asset_version_bindings(tenant_id, review_record_id, effective_valid_until);
create index non_proxy_asset_binding_variant_idx on private.non_proxy_asset_version_bindings(tenant_id, frame_variant_id, frame_model_id);
create index non_proxy_asset_binding_job_idx on private.non_proxy_asset_version_bindings(tenant_id, generation_job_id, frame_model_id);
create index asset_versions_exact_variant_idx on private.asset_versions(tenant_id, id, frame_model_id, frame_variant_id);
create index asset_version_sources_exact_source_idx on private.asset_version_sources(tenant_id, source_asset_id, frame_model_id, source_sha256);
create index asset_version_sources_exact_asset_variant_idx on private.asset_version_sources(tenant_id, asset_version_id, frame_model_id, frame_variant_id);

revoke all on private.qa_reviewer_authorities, private.non_proxy_human_qa_records, private.non_proxy_asset_version_bindings from public, anon, authenticated, service_role;
revoke execute on function private.validate_non_proxy_reviewer_authority_update() from public, anon, authenticated, service_role;
revoke execute on function private.validate_non_proxy_human_qa_record() from public, anon, authenticated, service_role;
revoke execute on function private.validate_non_proxy_binding() from public, anon, authenticated, service_role;
revoke execute on function private.validate_asset_version_source_insert() from public, anon, authenticated, service_role;
revoke execute on function private.validate_asset_insert() from public, anon, authenticated, service_role;
revoke execute on function private.validate_asset_update() from public, anon, authenticated, service_role;
revoke execute on function private.validate_generation_event_chain() from public, anon, authenticated, service_role;
revoke execute on function private.validate_qa_decision() from public, anon, authenticated, service_role;
