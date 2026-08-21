# Jessica Supabase control-plane schema

This directory contains a data-free, local-first Supabase/Postgres migration.
It does not link to, inspect, or mutate a remote project.

## Local verification

Requirements: Node.js 22+ and the lockfile-pinned dev dependency
`@electric-sql/pglite@0.5.4`.

```sh
npm ci
npm run db:verify
node --test tests/control-plane-db.test.mjs
```

The harness creates only local `anon`, `authenticated`, `service_role`,
`auth.users`, and `auth.uid()` stubs before executing the production migration.
Those stubs are not present in the migration. PGlite runs PostgreSQL 17-compatible
WASM in memory and writes no database artifact to the repository.

Expected focused result: 60 SQL assertions, 19 RLS-enabled/forced private tables,
19 tenant-membership SELECT policies, two `security_invoker` API views, three
synthetic publication events, and successful `SET ROLE authenticated` RLS isolation.
Synthetic rows exist only inside the ephemeral test database and are not product,
approval, publication, deployment, or gate evidence.

`npm run db:verify` also executes the separate fresh v1→v2 JSC-0218 verifier.
The v2 migration adds three admin-only private relations (22 total forced-RLS
tables); it deliberately adds no policies, SELECT/mutation grants, view, or RPC,
so the total policy count remains 19. The verifier executes real trigger paths,
role denials, immutable-row cases, exact source/variant and asset-projection
bindings, authority revocation, stale-head serialization, publication/live
denials, policy age/freshness equality, and the data-free cutover refusal. SQL
stores bounded maximum review age plus policy/fresh/effective horizons and enforces
their relational equality, append-only and transition invariants; it does not establish ES256 trust, JWK
fingerprints, canonical payload/row/source-set/asset digests, or host review-policy
truth. Only a future trusted adapter that re-runs raw JSC-0215 may write.

## Schema boundary

- Configure only `api` as a Data API exposed schema. Do not expose `private` or
  add it to PostgREST's extra search path.
- `authenticated` receives SELECT on two `api` views and only the four private
  base tables those security-invoker views require. RLS still checks normalized
  active membership. `anon` receives nothing.
- Trusted server/worker mutations use a dedicated least-privilege database role
  designed in a later migration. The browser never receives service/secret keys.
- Public-live consumes a signed immutable Deployment document from the delivery
  plane/CDN API. It never queries Supabase with service credentials.

## Remote-apply preconditions

Do not apply this migration until all of the following exist and have been reviewed:

1. A new dedicated Jessica Supabase project. Never reuse `ryusei-staging`,
   `RYUSEI`, or another unrelated project.
2. A verified backup/restore point and a forward-recovery rehearsal.
3. A migration dry run against an empty PostgreSQL 17-compatible clone.
4. Supabase database/security advisors reviewed with no unresolved findings.
5. Data API configuration exposing only `api`, followed by hosted role/RLS tests
   for member, non-member, revoked member, `anon`, and service-side roles.
6. Explicit trusted mutation roles and grants; the migration intentionally exposes
   no review or publication mutation RPC.
7. A production key-management/signing authority, rotation/revocation procedure,
   real pseudonymous actor policy, and canonical envelope/signature verifier.
8. Immutable object/CDN URLs, actual-byte hashes, backup policy, monitoring, and
   incident/rollback ownership.
9. Reviewed real approval/publication evidence. Schema readiness itself creates
   none.

No production key, actor, URL, signature, evidence row, or Supabase project is
provided here.

## Recovery

Supabase migration history is forward-only. There is no destructive down script.
Before remote apply, take a backup and rehearse restore. After apply, recover by a
reviewed compensating migration generated with the pinned Supabase CLI; restore the
backup if the migration transaction itself cannot complete safely. Never edit an
already-applied migration or run ad hoc object drops in production.
