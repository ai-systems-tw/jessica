# ADR-0016: Local Supabase control plane and publication authority boundary

- Status: Accepted
- Date: 2026-08-11

## Context

Jessica has strict file and TypeScript contracts for capture, generation, review,
immutable runtime assets, and signed active deployments, but no relational control
plane. The available connected Supabase projects are unrelated to Jessica. This
decision therefore defines and verifies a migration locally only. It creates no
remote project, product row, approval, publication, deployment, actor, key, or gate
evidence.

The database must preserve the authority split already established by ADR-0008,
ADR-0011, ADR-0012, and ADR-0015. A catalog recommendation is runtime eligibility
metadata; it is not publication authority. Public-live continues to consume an
immutable signed Deployment document through the delivery plane, never Supabase
service credentials.

## Decision

The control plane uses two application-owned schemas:

- `private` contains normalized tenant membership, product identities, inspected
  source and measurement evidence, generation identities/events, immutable asset
  bytes and manifests, review decisions, signing-authority public identity,
  immutable deployment envelopes, the current publication pointer, and append-only
  audit/publication events. It is not a Data API exposed schema.
- `api` is the only candidate Data API schema. It contains narrow
  `security_invoker` review/read views and no mutation function.

Every base table has RLS enabled and forced. Authenticated reads are admitted only
when `private.is_tenant_member(tenant_id)` finds an active normalized membership for
the current `auth.uid()`. The helper is `SECURITY DEFINER` solely to avoid membership
RLS recursion; it is outside the exposed schema, uses `search_path = ''`, rejects a
null `auth.uid()`, qualifies every object, revokes execution from `PUBLIC`, `anon`,
and `service_role`, and grants execution only to `authenticated`. Authorization does
not use `user_metadata` or JWT `app_metadata`, because user metadata is editable and
app metadata can remain stale until token refresh.

Membership authorization requires both an active normalized membership and an
active tenant row. Suspending or retiring a tenant therefore removes all tenant-row
visibility immediately even if a membership record remains active.

Postgres views cannot own RLS policies. The `api` views therefore use
`security_invoker = true`, while RLS and tenant membership predicates are enforced
on every underlying `private` table. Grants and RLS are both required: `anon` has no
schema/table/view/function access, and `authenticated` receives only the base-table
SELECT privileges needed by the two views plus view SELECT.

Asset identity, version, URLs, hashes, source bindings, and geometry metadata are
immutable. Only the explicit status state machine may update an unpublished asset;
a published asset cannot be changed in place. Immutable resource URLs are bound to
one SHA-256. Deployment envelopes are append-only and bind the exact tenant/site/
environment selector, immutable asset, catalog/manifest/model hashes, authority,
signature, revision/generation, and prior envelope. One publication-stream row is
the sole active pointer for each tenant/site/environment. Replacing or rolling back
that pointer requires a newly inserted deployment whose revision and generation
both increase and whose prior pointer exactly matches the current deployment. The
pointer trigger appends publication evidence; it never treats catalog
`recommendedForLive` metadata as an activation input.

Pointer activation revalidates the target against the exact deployment currently
held by the stream, not merely the current pointer at deployment insertion time.
This rejects delayed activation of a stale side branch. A stream cannot be deleted.
Signing-authority identity and public key material are immutable; an authority may
transition once from active to revoked, cannot be re-enabled/deleted, and a revoked
key cannot authorize or activate a new Deployment. Deployment catalogs must bind an
immutable publication resource whose kind is exactly `catalog`.

Generation events, measurement evidence, QA decisions, deployments, audit events,
and publication events are append-only. Trigger functions are used only for
cross-row event-chain, immutable-state, and pointer-lineage facts that declarative
constraints and foreign keys cannot prove.

## Compatibility and current official guidance

This migration targets the connected-project baseline of PostgreSQL 17 and uses
PostgreSQL 15+ `security_invoker` views. It creates no extension, and therefore has
no extension version clause. Supabase deprecated extension version pinning starting
2026-08-05; explicit requested versions are ignored now and may be rejected later.

Current official references checked on 2026-08-11:

- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): `TO authenticated` is only a role filter; tenant predicates are still required, UPDATE needs SELECT plus `USING` and `WITH CHECK`, user metadata is unsafe for authorization, app metadata may be stale, and PostgreSQL 15+ views should use `security_invoker`.
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api): grants and RLS are separate controls, exposed objects require RLS-equivalent protection, and a dedicated API schema keeps internal objects outside the reflected surface.
- [Database Functions](https://supabase.com/docs/guides/database/functions): prefer invoker functions; any necessary definer function needs a fixed search path and explicit EXECUTE revocation/grants.
- [Tables and Data](https://supabase.com/docs/guides/database/tables): custom API schemas must be explicitly exposed and granted, and privileged views should be security-invoker.
- [Auth users](https://supabase.com/docs/guides/auth/users): user metadata is user-editable and must not be used for security-sensitive authorization; secret/service-role credentials remain server-only.
- [Extension version pinning deprecation](https://supabase.com/changelog/extension-version-pinning-ignored): explicit extension versions are deprecated from 2026-08-05.

## Verification and recovery

The committed Node harness boots PostgreSQL 17-compatible PGlite 0.5.4 in memory,
creates only Supabase role/auth stubs outside the production migration, executes the
migration, and exercises constraints, catalog policy/grant shape, membership helper
behavior, append-only evidence, asset immutability, and deployment replacement/
rollback lineage. PGlite role switching is attempted explicitly; if its embedded
runtime cannot enforce RLS exactly as hosted Supabase does, the harness reports that
residual and still verifies catalog definitions plus direct helper isolation. A
dedicated Jessica project must later run hosted RLS integration tests and database
advisors before any remote apply.

Supabase migrations are forward-only. Recovery is a reviewed compensating migration
after backup/restore rehearsal, never an ad hoc down script against production.

## Consequences

This establishes a non-promoting local control-plane foundation. G1 remains active
and not ready; G2 and G3 remain inactive. Publication still requires a dedicated
Jessica project, real authority and signing operations, approved evidence, delivery
plane configuration, backup, advisors, and a dry run. None are created here.
