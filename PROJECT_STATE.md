# Jessica Project State

## Canonical identity

- Product name: `Jessica`
- Intended repository: `ai-systems-tw/jessica`
- Initial business scope: fashion glasses and sunglasses
- Architecture status: high-level design and decomposition design frozen for implementation
- Current gate: `G1_SINGLE_FRAME_RUNTIME_ACTIVE`

## Completed in the initial implementation slice

- Repository structure and source-of-truth documents
- Unit and asset contracts
- Tracking filter primitives
- Confidence/failure state machine
- Quality metrics and deterministic sample report
- Camera-permission browser shell
- Automated tests and CI workflow

## JSC-0219 committed-review QA-preview reader reference

- The process-local server core now consumes strict raw attachment-matrix and
  quality-envelope projections rather than invented digest fields. Issue and
  single-shot use independently reauthenticate and recheck the complete current
  approve/binding/authority/job/source/MeasurementSet/variant chain; serialized
  receipts, plans, clones, caller clocks, and browser-minted objects remain
  inadmissible. Generic `qa-preview` loading still rejects before every fetch.
- Added a pinned PostgreSQL/PGlite reference reader. One physical lease activates
  a dedicated credentialless `NOLOGIN NOINHERIT NOBYPASSRLS` SELECT-only role,
  takes the writer-compatible authority → candidate → job session locks, then
  runs one `REPEATABLE READ READ ONLY` transaction. It repeats the locator after
  locking, reconstructs the full canonical JSC-0218A persistence plan, verifies
  row identities/digests, signed payload and ES256 signature, and finishes each
  final reread with authoritative `clock_timestamp()`. A trigger makes every
  committed non-Proxy AssetVersion status mutation, including retirement, take
  the identical candidate lock so it cannot race behind the reader snapshot.
- Driver data is detached and bounded to 128 aggregate rows; source lookup uses
  `LIMIT 33` and rejects 33 so at most 32 exact source mappings are accepted.
  Unknown lock/transaction/check-in/reset/unlock outcomes permanently discard
  the physical lease. PGlite v1→v4 verifies the exact role/policy/grant catalog,
  a trusted-writer approve chain, full reader reconstruction, and revocation
  failure.
- Local verification covers the focused core/adapter/DB/writer suites and the
  PGlite migration chain. JSC-0220 subsequently added the separate real
  PostgreSQL evidence described below. No browser transport/runtime bridge,
  production credential, remote database mutation, public-live/deployment/publication
  authority, physical evidence, or G1-G7 PASS is claimed. A non-client-mintable
  authenticated one-shot transport remains open.

## JSC-0219B / JSC-0220 PostgreSQL provider acceptance

- JSC-0219B does not replace the committed-review domain or SQL contract.
  JSC-0220 implements its selected pinned `node-postgres` `pg.Pool` provider.
  One `pool.connect()` checkout owns the
  complete locator/lock/transaction/final-clock/unlock/reset sequence, and
  ambiguous cleanup destroys rather than repools that client. The provider
  exclusively owns one dedicated pool, reserves its `release`/`remove` lifecycle
  events, rejects competing lifecycle listeners, and waits for the exact
  physical removal acknowledgement before treating discard as complete.
- The dedicated PostgreSQL acceptance job succeeded for head
  `dc3ee7a34c83e7848ae912a604520176665f1a16`: job
  [96973627205](https://github.com/ai-systems-tw/jessica/actions/runs/32549436572/job/96973627205)
  in run [32549436572](https://github.com/ai-systems-tw/jessica/actions/runs/32549436572).
  The completed workflow run is `SUCCESS`; its ordinary `verify` job and the
  dedicated PostgreSQL job both passed.
  It applied v1→v4 to an empty PostgreSQL 17.11 database, retained default `int8`
  text decoding, proved distinct backend PIDs and actual advisory blocking for
  authority/candidate/job ordering, revoke/head/retire races, exact DB-clock
  expiry, real statement-timeout rollback, destructive discard/nonreuse, and
  fresh-client recovery. PGlite remains complementary, not this evidence.
- The disposable CI boundary uses a digest-pinned PostgreSQL 17.11 image, a
  10-minute job limit, 5-second pool checkout limits, strict local URL/database
  admission, and an empty user-namespace preflight. This completes only the
  JSC-0219B provider/real-PostgreSQL acceptance item. Production host pool/TLS/
  credential/application-role configuration, Supabase/Cloudflare mutation,
  browser transport/runtime, real private rows, physical evidence, and G1-G7 authority
  remain absent.

## JSC-0217 camera projection profile boundary

- Added strict immutable `CameraProjectionProfileV1` parsing/canonical identity in `packages/contracts` and
  production P-256 verification/admission in runtime. The profile binds exact decoded geometry, calibrated
  `fx/fy/cx/cy`, rectified distortion, artifact integrity, provenance/authority, validity, display policy, and
  an opaque origin-scoped device binding. Hostile structures, aliases, tampering, stale profiles, and ambiguous
  rollover tuples fail closed; fixture authority is structurally separate.
- Public-live requires an exact signed Deployment/prior/receipt profile-set binding and verified bytes before
  camera acquisition. After permission and before backend/Worker/WebGL/RAF, exactly one current profile must
  match device, width/height, facing, intrinsic video dimensions, `resizeMode:none`, and default zoom/pan/tilt.
  Source/optical drift is guarded inside inference before render and checked each RAF; failure stops the camera
  with only `CAMERA_PROJECTION_UNAVAILABLE`. The minimum Deployment/catalog and profile deadline is also
  rechecked after permission and projection resolution immediately before runtime construction.
- Pose, horizontal iris scale, depth mesh, Three.js, and still capture consume capability-owned calibration
  snapshots from the same admitted projection. K uses exact post-browser decoded pixel edges (`u=x*W`,`v=y*H`),
  asymmetric principal points, centered contain/cover CSS mapping, and no DPR. Responsive viewport snapshots do
  not mutate physical K. Mirroring is compositor-owned once across video+canvas; math remains unmirrored.
- This is a code-level fail-closed boundary only. Origin-scoped/per-unit browser device IDs make the bounded
  static set a calibrated lab/kiosk allowlist, not arbitrary ecommerce fleet coverage. Real calibration
  artifacts/residuals, five device classes, physical J1-M, exact-45 actual wear, production authority/deployment,
  and `G1 PASS` remain external. `G1_SINGLE_FRAME_RUNTIME_ACTIVE` remains unchanged and not PASS.
- Final verification after lifecycle/watchdog hardening: clean `npm ci`, typecheck, all 565 deterministic tests,
  intentionally-not-ready evidence-template check, `git diff --check`, and private/secret/media scans pass.
  The parent environment `npm audit --audit-level=low` reports zero vulnerabilities.

## JSC-0216 runtime application coordinator

- Added one testable `RuntimeApplicationCoordinator` as the exclusive public-live owner of signed
  Deployment/asset preflight, `CameraSession`, `SingleFrameRuntime`, RAF, page lifecycle, and teardown.
  The real app now drives the existing `RuntimeLifecycle` reducer; preflight UI phase is orthogonal
  and remains cancellable without adding a weaker lifecycle machine.
- Immutable public-live configuration and the complete admitted asset chain are verified before camera
  acquisition or backend/Worker/WebGL/renderer construction. Calibration SELF_TEST remains explicit,
  disables live controls, and is disposed on page hide/destroy.
- Serialized generation ownership prevents old stop/failure continuations from resetting or disposing a
  newer session. Every terminal path invalidates RAF/watchdogs/in-flight work, hides through runtime
  disposal, stops tracks, clears video, contains observer/remover/RAF exceptions, and rejects stale results.
- Permission denial and unsupported environments retain their dedicated reducer states. All other public
  failures expose only closed stable codes and fixed Japanese messages; raw URL/query/path/stack/network
  messages are not rendered. Application-level WebGL context loss is terminal and requires explicit restart.
- `SingleFrameRuntime` now gives backend initialization a cancellation/settlement capability: dispose
  triggers active backend cancellation immediately, initialization rejects locally even while pending,
  and replacement initialization cannot overlap an old capability or suffer stale-dispose ABA.
- Detection and render cadence remain coupled for this code-reliability ticket. No performance PASS or
  device result is inferred; cadence separation remains subject to later live-device evidence.
- No physical J1-M, actual-wear, device, production Deployment, Supabase/Cloudflare mutation, key, private
  A3893 byte, or `.env` evidence was added. `G1_SINGLE_FRAME_RUNTIME_ACTIVE` remains unchanged and not PASS.
- Verification passes typecheck, 43 focused runtime/lifecycle tests, all 541 deterministic tests, the
  intentionally-not-ready evidence-template check, `git diff --check`, and private/secret/media scans.
  The parent environment dependency audit (`npm audit --omit=dev`) reports zero vulnerabilities.
- A parent Chrome smoke on the frozen source confirms normal mode rejects missing signed Deployment
  configuration during preflight before camera acquisition, exposes only the fixed public message, and
  records no console warning/error. The pinned-fixture calibration SELF_TEST hit the same Worker inference
  timeout on both JSC-0216 and its `00a9f90` baseline, so no new browser tracking PASS is claimed.

## G7-A Fit Intelligence local preparation slice

- Added strict `g7-a-local-v1` product-candidate, input, evaluation, and command boundaries over only the existing
  five FrameMeasurements millimetre fields. Exact tenant/site/production, SKU/model/variant, MeasurementSet,
  source-set, and derived candidate digests are bound; reference self-inclusion and cross-scope/relabelled products
  fail during input parsing.
- Frozen an explicitly non-production, externally unvalidated candidate policy: five fixed per-dimension
  thresholds, integer weights, a two-threshold eligibility limit, and top-five cap. Ranking is deterministic under
  input reorder and ties use SKU/model/variant then digest. Every dimension has a closed relation and explanation.
- `verified-physical-mm` remains an upstream assertion only. Outputs say all measurement/source/catalog digests are
  unverified references and deny their authority; missing/invalid input fails, an unverified reference routes
  manual/unavailable, and unverified/out-of-policy candidates are explicitly excluded.
- Output text is one fixed reference-product statement that does not assess personal suitability. Face-relative
  width is explicitly deferred until calibrated physical/device evidence exists. Outcome measurement is
  `pending-external`, non-causal, unmeasured, and cannot infer purchase from interaction.
- Evaluation/command replay rejects hostile structures, duplicates, self/relabel/redigest, reorder, stale/future,
  cross-scope, output/authority escalation, and async caller mutation. Frozen allowlists cannot be extended.
- Every result is `local-preparation-only`, `g7Ready:false`, with recommendation publication, personalization,
  physical suitability guarantee, medical/biometric inference, measurement/source/catalog authority, catalog
  mutation, analytics/remote write, and G1/G2/G5/G6/G7 evidence false. No adapter, persistence, network,
  filesystem, SQL, Supabase, or R2 path was added (ADR-0026). G7 remains `NOT ACTIVE / NOT PASS`.
- Parent verification passes clean `npm ci`, typecheck, 15 focused G7-A tests, all 429 deterministic tests, the
  intentionally expected-false evidence-template check, `git diff --check`, and online `npm audit` with 0
  vulnerabilities.

## G6 External Service Readiness local preparation slice

- Added one strict `g6-local-v1` readiness profile and one bounded usage-event ledger/summary/command boundary.
  The profile binds exact tenant/site/production, distinct parent/widget HTTPS origins, contained widget path/URL,
  and exact catalog/asset origins; wildcard, credential, path/query/fragment, suffix, and cross-scope tricks fail.
- Derived embed requirements reuse WidgetProtocol v1 and the canonical Hosted Widget CSP, Permissions-Policy,
  sandbox, and camera ownership. They are unverified candidates and still require actual production headers and
  live cross-browser evidence.
- The frozen meter taxonomy counts only widget session open, try-on start, and catalog-selection success as
  one-occurrence local candidates. Its 256-event/24-hour hash chain is replayable and non-billable and carries no
  media, capture reference, raw error, medical/prescription, pricing, invoice, payment, or free-form data.
- Authenticated tenant authority, billing/pricing, continuous self-operation, legal/IP review, production headers,
  real usage, signed onboarding, and support staffing remain fixed `pending-external`. Support SLA/channel are null.
- Every result is `local-preparation-only`, `g6Ready:false`, with provisioning, activation, origin authorization,
  billing/invoicing/pricing, publication/deployment, production headers, SLA/legal/onboarding, and G1/G2/G5/G6
  authority false. No persistence, network, filesystem, production adapter, or remote mutation exists (ADR-0025).
- G6 remains `NOT ACTIVE / NOT PASS`; this slice is local contract and pure-core evidence only.
- Parent verification passes clean `npm ci`, typecheck, 12 focused G6-A tests, all 414 deterministic tests, the
  intentionally expected-false canonical evidence-template check, `git diff --check`, and online `npm audit`
  with 0 vulnerabilities.

## F4 Reprocessing local preparation slice

- Added strict schema-v1 request, append-only event ledger, pure plan, and canonical command contracts under
  `f4-local-v1`. Exact bindings cover tenant/site/production, SKU/model/variant, prior asset/version plus
  manifest/model hashes, prior GenerationJob/review/QA candidate digests, immutable source/capture digest
  candidates, and new generation request identity/input hashes.
- Regeneration stops at one unverified digest-reference attempt. `rawMaterialStatus` is
  `digest-references-only-unverified`, raw-material authority and generation execution are false, and a retry
  requires a new immutable request. No raw byte/reference/path/URL/media or local store handle enters the contract.
- The contract-owned trusted reducer verifies a maximum-five-event monotonic hash chain and derives exact prefix
  states. Complete closed metric evidence alone can derive better/equivalent; missing/partial metrics route manual,
  and any regression cannot become canary eligible.
- Canary is an exact-SKU, partial-traffic, finite-duration local plan requiring later human/control-plane authority.
  Rollback is only an exact older unverified prior-version reference named `rollback-reference-manual-required`;
  it is never automatic or executable.
- Durable commands independently replay their embedded ledger and deny raw access, execution, QA, promotion, live
  recommendation, Deployment mutation, publication, automatic rollback, human/control-plane authority, and
  G1/G2/G5 evidence. Output remains `local-preparation-only`, `g5Ready:false`. See ADR-0024.
- Parent verification passes clean `npm ci`, typecheck, 12 focused F4 tests, all 402 deterministic tests, the
  intentionally expected-false canonical evidence-template check, `git diff --check`, and online `npm audit`
  with 0 vulnerabilities.

## F3 Review Operations local preparation slice

- Added strict schema-v1 work-item, append-only evidence-chain, queue-build, queue-item, and canonical
  command contracts. Every record binds tenant/site/production, SKU/model/variant, GenerationJob and
  reviewed input/output candidates, asset/version candidate, `f3-local-v1`, and nonzero source/capture
  candidate digests. F1/F2 are accepted only as nullable digest candidates.
- Candidate digests are explicitly `candidate-references-unverified`: binding proves local integrity, not
  that a GenerationJob ledger, F1 command, F2 log, source system, or capture operation was authenticated.
- Evidence fixes `evaluationAuthority=local-candidate-unverified`; evaluator IDs/versions and findings are
  unauthenticated local candidate labels, never authenticated human review or source proof. Runtime parser
  allowlists are frozen, so consumers cannot extend accepted findings, reasons, or outcomes by mutation.
- Pure replay derives only `auto-review-candidate`, `correction-required`, `manual-required`, or `rejected`
  using closed sorted findings and deterministic severity/order. Auto-candidate grants no QA approval,
  AssetVersion promotion, live recommendation, deployment, publication, or G1/G2/G5 evidence.
- Corrections are limited to three attempts. Exhaustion routes to manual-required; manual requires later
  explicit human-review authority. Rejected evidence is terminal, while a new generation plus distinct
  asset/version candidate creates a new work identity.
- Durable queue items carry their complete bounded evidence chain. Command parsing replays that chain,
  verifies canonical hashes, binding, sequence, attempt, prior digest, time, freshness, terminal state,
  reasons, severity, and order, and rejects orphaned or freshly redigested status escalation.
- Exact evidence retry is accepted only adjacent to its original event. Unknown fields, accessors, symbols,
  custom prototypes, cycles, sparse/oversized arrays, duplicate/relabelled identities, stale/future/reordered
  evidence, queue substitution, and async TOCTOU mutation fail closed.
- Contracts contain no `localraw:` reference, raw bytes/path/URL/media, people/session/camera/biometric data,
  free-form notes, or commerce/analytics payload. The local application uses only injected read/write/clock
  ports and adds no SQL, Supabase, R2, network, publication, or remote mutation.
- Every command is `local-preparation-only`, `g5Ready:false`, and contains explicit false authority fields.
  No physical, image, device, rights, actual-wear, production-operation, or gate claim is created. See ADR-0023.
- Parent verification passes clean `npm ci`, typecheck, all 390 deterministic tests, the intentionally
  expected-false canonical evidence-template check, `git diff --check`, and online `npm audit` with
  0 vulnerabilities.

## F2 Batch Capture local preparation slice

- Added strict schema-v1 bounded batch events and a pure replay state machine for open, SKU/model/variant
  binding, private raw-reference recording, quality decision, item advance, and batch completion.
- Bound every event to tenant/site/production/operator-session/batch and monotonic sequence/time. SKU and
  item identities are batch-unique; variants cannot move across SKU/model identities. Multiple variants
  under one FrameModel remain intentional catalog behavior compatible with E2/F1, while product type is
  model-stable and at most one variant tuple per model may be classified `model-primary`.
- Added closed operator product/variant classifications and stable quality issue codes. Retake never
  advances; accept/reject are retained as distinct completed outcomes so completion is not approval.
- Added an application-owned WeakMap capability boundary for bounded `localraw:` references. Capability
  identity is not structurally forgeable, is exact batch/item/reference/expiry bound, consumes once only
  after final replay/budget validation succeeds, and allows exact-boundary use within the event timestamp's
  2020–2100 range. Capture/capability/reference identities are
  batch-global and cannot be reused or relabelled later.
- Raw camera/product bytes, paths, URLs, data URLs, public/widget/commerce/analytics fields, and raw
  errors do not enter the contract or fixtures. No camera, filesystem, raw upload, SQL, Supabase, R2,
  network, public publication, or analytics adapter was added.
- Added exact already-appended retry idempotency, deterministic log SHA-256, deep normalization/freezing,
  and explicit 100-item/1,000-event/1-MiB/16-issue budgets.
- Added focused adversarial tests for happy/retake/reject flows, replay/reorder/stale transitions,
  identity relabels, global capture authority, capability forgery/expiry/consumption/substitution,
  TOCTOU aliases, unknown/accessor/prototype/cycle/sparse/oversize inputs, and private-reference shape.
- Completion records only `local-preparation-only` and `g5Ready:false`. This creates no physical, rights,
  actual-wear, real device, production operations, G1, G2, or G5 evidence. See ADR-0022.
- Parent verification passes clean install, typecheck, all 377 tests, the expected-false canonical
  quality-evidence template check, diff checking, and online `npm audit` with 0 vulnerabilities.

## F1 Demand Queue local preparation slice

- Added strict v1 unavailable-demand, sales-rank, inventory-eligibility, frame-shape coverage,
  build, and command contracts. They contain only bounded tenant/site/product/candidate identities,
  closed enums/integers/timestamps, and no people/session/device/biometric/media/free-form fields.
- Added explicit E2 and E3 adapters. Only qualifying stable unavailable signals enter the core;
  shared request correlation makes the two adapters alternative evidence and prevents double count.
- Added scope-wide SKU/variant/candidate anti-relabel, replay/correlation deduplication, future/
  conflict rejection, and deterministic latest-snapshot selection.
- Frozen policy `f1-local-v1`: inclusive 30-day demand, 24-hour rank, 1-hour inventory, 7-day
  coverage; fresh continuous in-stock is required; missing/stale rank or coverage earns no bonus.
  Priority is `demand × 1000 + rank 0..100 + underrepresented shape 25`, then oldest demand and
  canonical identity, so demand remains dominant without a 100-count cap.
- Added 1,000 evidence/sample, 500 item, and 512 KiB command budgets. Canonical command parsing
  validates nested targets/reasons/score/window/order/uniqueness, returns a deep-frozen snapshot,
  and derives SHA-256/output idempotency. Equivalent operational outputs intentionally coalesce;
  the digest is not authoritative raw-source provenance.
- Added contained injected clock/read/write ports with exact accepted/idempotent acknowledgement.
  Hostile input/response, observer/port exception, cross-scope substitution, and score manipulation
  fail closed.
- Added 12 focused deterministic tests covering adapters, demand replay/reorder, window/freshness
  boundaries, no/unknown/stale stock, rank/coverage states, equal-score order, demand dominance,
  tenant/site and relabel isolation, hostile privacy inputs, redigested commands, TOCTOU, capacity,
  G5 false, and port failures. See ADR-0021.
- Verification: pinned `npm ci`, typecheck, 12/12 focused tests, 364/364 full deterministic tests,
  the intentionally gate-not-ready quality evidence template check, and `git diff --check` pass.
  Parent-environment online `npm audit` reports 0 vulnerabilities.
- No SQL, Supabase migration, remote write, or physical asset was added. This is local preparation;
  real sales/inventory, representative catalog, production queue/operations, human effort, physical
  assets, and G5 activation/passage remain external. Current gate stays `G1_SINGLE_FRAME_RUNTIME_ACTIVE`.

## E4 Static/Low-Vision UX local slice

- Added a DOM-free pure controller/reducer with explicit unavailable, ready, exact 3→2→1
  countdown, capturing, review, failed, paused, closed, and destroyed states. Timer callbacks
  are generation-bound and one-shot; duplicate, stale, synchronous reentrant, cancelled,
  hidden, and destroyed callbacks cannot create extra captures.
- Added injected AbortSignal capture, timer, and optional audio ports. Audio is default-off,
  explicitly user-controlled, and non-blocking when unavailable or rejected. Camera loss,
  cancellation, page hide, retake, terminal close, and destroy abort/dispose current and late results.
- Browser still composition is dimension-bounded and retains the temporary JPEG only behind a
  revocable local Blob object URL. No image bytes, landmarks, pose, biometrics, capture reference,
  raw error, or free-form telemetry enter public state serialization or external persistence/transmission.
- Added large native controls, labelled live regions/timer/dialog, inert modal background,
  focus entry/restoration, Escape terminal close, descriptive still review, visible focus,
  contrast-safe tokens, textual failure meaning, reduced motion, and forced-colors behavior.
- E1 receives only a validated bounded local opaque capture reference; E3 receives only an
  argument-free occurrence. Observer failures cannot change the local review outcome.
- Local evidence: pinned `npm ci`, typecheck/build, 18 focused deterministic/static tests,
  all 352 deterministic tests, the intentionally gate-not-ready quality template check, and
  clean tracked/untracked diff checks pass. Parent-environment online `npm audit` also reports
  0 vulnerabilities.
- Parent local-browser shell smoke confirms the labelled regions/buttons/status, large-control
  layout, audio toggle `aria-pressed` update with retained focus, and zero console warnings/errors.
  Camera permission was not requested; this is not camera/device/assistive-technology evidence.
- This is local preparation, not accessibility certification, assistive-technology/browser/device
  evidence, physical evidence, production capture/telemetry/consent, remote mutation, or a G1/G2/G3/G4
  claim. Existing-glasses overlay remains research-only and unimplemented. See ADR-0020.

## E1 Hosted Widget v1 local protocol/security slice

- Added strict fail-closed WidgetProtocol v1 contracts exported by
  `packages/contracts`: exact commands/events/payloads, bounded tenant/session/request
  correlation, closed lifecycle, unknown rejection, recursive structural limits,
  biometric/media/geometry/raw-analytics denial, local opaque capture references,
  and sanitized stable errors.
- Added reusable DOM-free parent iframe and reciprocal widget adapters with exact
  HTTPS origin/URL/path containment, never-wildcard target origins, minimal documented
  sandbox/camera delegation, source/origin/tenant/session/request binding, replay/
  collision/stale-state rejection, protocol-only SKU changes, and safe lifecycle.
- Added deterministic negative and happy-flow tests, a message-only camera-free
  fixture, ADR-0017, and candidate CSP/Permissions-Policy ownership documentation.
- Local evidence: `npm ci`, typecheck, 24 focused Widget tests, all 295 deterministic
  tests, the intentionally not-ready evidence-template check, diff validation, and
  `npm audit` all pass; the audit reports 0 vulnerabilities.
- Parent-audit hardening reserves bound inbound IDs before lifecycle/controller
  dispatch, adds non-throwing safe contract results, deterministic per-command
  recoverable rollback, exact close-reason binding, explicit spontaneous-error
  semantics, and non-throwing at-most-once bridge transport failure.
- Final parent-audit hardening adds reply-independent terminal close for in-flight
  init/open teardown, inert queued callbacks after destroy, post-terminal widget
  outbound denial, exception-contained parent observers, and transactional listener
  setup cleanup.
- Added the shared exact 256-message/session sent+received replay budget. Command
  paths reserve correlated-response capacity before effects; no old ID is evicted.
  Exhaustion clears pending work, closes locally with `MESSAGE_LIMIT`, emits no
  protocol echo, and makes later transport inert. Malformed/wrong-binding inputs do
  not consume the ledger. This is local memory protection only; no remote rate
  limiting or production abuse control is claimed.
- This is local tooling only. Signed embed token/API key/authentication, origin
  authorization, analytics backend, production headers/delivery, live EC/cart and
  camera-permission behavior, and physical/device evidence remain deferred. No remote
  service was mutated and no G1/G2/G3/G4 gate is promoted.

## E2 deployed catalog integration local boundary

- Added strict request and unavailable-event v1 contracts binding bounded commerce
  request/tenant/site/production/SKU/model/variant IDs and exact fallback policy.
- Added a pure evaluator: exact SKU never silently falls back; a missing SKU may use
  only an explicit same-model target that exactly matches the verified active
  Deployment tenant/SKU/model/variant/asset ID/version/manifest binding.
- Added a reusable deployed adapter and non-fatal privacy-safe sink. Invalid unknown
  input is rejected before network and is not logged; sink failure cannot change the
  primary closed result. Catalog recommendation/default metadata creates no authority.
- Added one-key cancellable first-asset prefetch. Same-key concurrent consumption
  shares the verified GLB bytes without a second catalog/manifest/model fetch.
- Hardened catalog, manifest, signed-envelope, and Deployment unknown records/arrays
  against getters, symbols, and custom prototypes before dereference. Envelope bytes
  now use a cancellable 256 KiB streaming bound even without Content-Length.
- Host deployment origins are now non-empty exact canonical HTTPS origins. Credentials
  are rejected on every deployment/catalog/manifest/model and redirect URL, and all
  post-Response status/origin/credential/declared-size failures cancel unread bodies.
- Deployment verification carries the minimum signed-expiry/host-maximum-age
  deadline. Cache use requires strict `now < deadline`; deadline/after refetches and
  reverifies without weakening monotonic receipts.
- Cache identity excludes requestId but includes all immutable selection/fallback
  semantics. Consumer failure is correlated to its own requestId, and consumer-local
  `REQUEST_CANCELLED` never aborts another consumer's shared prefetch.
- Every primary or same-key secondary prefetch handle owns the one shared speculative
  operation; any handle's explicit `cancel()` cancels it for all prefetch owners.
- Propagated abort plus credentials-omit/no-store/no-referrer/redirect policy and
  added 1 MiB catalog, 256 KiB manifest, and 32 MiB GLB response bounds while
  preserving existing actual hash/length/origin/shared-GLB validation.
- Added deterministic happy, fallback-negative, privacy, observer-failure,
  concurrency, cancellation, unknown-input, and byte-bound tests plus ADR-0018.
  Typecheck and all 321 deterministic tests pass; clean diff validation passes.
- This is local ports/fake-network evidence only. It makes no browser/CDN/network,
  telemetry, commerce, deployment, remote mutation, physical asset, or gate-promotion
  claim. Current G1 and physical G1/G2/G3 blockers are unchanged.

## E3 commerce events local boundary

- Added a strict schema-v1 unknown-input commerce event union for open, permission
  result, try-on start, product change, capture occurrence, cart request, close, and
  stable error classification. Every event binds tenant/site/environment/session,
  single-use event/request IDs, bounded timestamp/sequence, and immutable product-chain
  attribution where required.
- Camera frames/images, landmarks, pose/scale/biometrics, capture bytes/URLs/references,
  secrets, paths/stacks, arbitrary error text, and free-form analytics properties are
  absent from the contract. Widget capture references are deliberately discarded;
  only capture occurrence is recorded.
- Added a pure lifecycle reducer rejecting replay, reorder, cross-binding, impossible
  permission/start/capture/cart transitions, implicit product relabel, fatal
  continuation, and post-close events.
- Added exact 8,192-byte event, 32-event/32,768-byte final canonical batch,
  256-event/four-hour session,
  and 5,000 ms dispatch budgets; deterministic batch idempotency; AbortSignal; closed
  retry/terminal classification; and exception isolation.
- Parent-audit hardening binds `batchSha256` and `ceb1_<digest>` idempotency to the full
  canonical projection, includes envelope metadata in `byteLength`, and chains batches
  with `priorBatchSha256`. A required ledger evaluator replays every event before sink
  dispatch and advances only on acceptance.
- Sink results now reject getters/custom prototypes/symbols/unknown fields without
  dereference; timeout setup/cleanup failures cannot escape. Nonrecoverable errors
  transition directly to terminal closed from created/open/active states.
- Production attribution now comes only from a try-on-web registry backed by the
  public-live loader's private exact-object proof. Structural clones, QA/calibration,
  unregistered, or mismatched assets cannot self-authorize; the arbitrary resolver is
  explicitly local/test-only.
- Final parent-audit hardening scopes every production registry to one bounded exact
  tenant/site/production identity. Proof registration, resolution, and session creation
  reject cross-tenant/site/staging use; identical SKUs remain isolated by registry.
- Pure batch replay retains structural state, while public dispatch now requires a
  module-issued private-WeakMap opaque ledger. A plain forged active/cross-session state
  cannot use a correct prior digest to authorize cart-before-open or reach the sink.
  Parent final audit additionally made each ledger a one-shot capability: concurrent
  dispatch and reuse after acceptance are rejected locally, while retryable failures
  release the same ledger without advancing it.
- Added explicit ParentWidgetHost observer and DeployedCatalogIntegration unavailable-
  sink adapters. They re-parse inputs, avoid WidgetProtocol double counting, strip raw
  protocol/catalog error detail, and cannot affect primary try-on/catalog/cart behavior.
- No SQL or remote mutation was added. The Supabase control plane, G1/G2/G3/G4 status,
  and physical blockers are unchanged. Local/fake sink results are not production
  telemetry, consent, analytics, commerce, browser/network, or gate evidence.
- Automated evidence: clean `npm ci`, typecheck, all 334 deterministic tests,
  fail-closed canonical evidence-template check, zero-package-vulnerability audit,
  and clean diff validation pass.

## Completed G1 implementation slices

### `JSC-0201` MediaPipe Face Landmarker adapter

- Pinned `@mediapipe/tasks-vision@1.0.1`.
- Added a replaceable `FaceTrackingBackend` implementation with externally configured WASM and model paths.
- Build output self-hosts the pinned MediaPipe WASM files; the reviewed task model must be provisioned separately.
- Added initialization timeout, no-face handling, strict timestamp ordering, 4x4 matrix validation, network observation hooks, disposal, and clean reinitialization.
- Added deterministic adapter tests using an injected MediaPipe factory; live model/device evidence remains part of G1.

### `JSC-0202` Pose/camera adapter and `JSC-0202B` scale resolver

- Added deterministic column-major MediaPipe transform conversion into Jessica/Three.js camera space.
- The original JSC-0202 slice added selfie mirroring, `cover`/`contain` viewport mapping,
  vertical-FOV unprojection, canonical cm-to-m conversion, and configurable nose-bridge anchoring.
  JSC-0217 supersedes that projection authority with calibrated asymmetric K and removes the FOV fallback.
- Added MediaPipe iris pixel observations, bilateral consistency checks, rolling median, outlier rejection, low-pixel confidence downgrade, and explicit manual scale override.
- Added a frozen canonical pose fixture plus center, edge, mirror, crop, camera agreement, and scale-confidence tests.

### `JSC-0203` Three.js renderer shell and `JSC-0204` depth occlusion

- Pinned `three@0.185.1` and self-hosted the browser module plus the GLTF loader dependency graph.
- Added transparent WebGL scene lifecycle, GLB loading, immutable attachment-matrix application, camera near/far checks, lighting, DPR cap, resize observation, and deterministic disposal.
- Added pose/opacity application, physical scale correction with safety bounds, and fail-closed visibility.
- Added a dynamic depth-only facial mesh using validated MediaPipe tessellation triangles and per-frame viewport/depth mapping.

### G1 web vertical-slice integration

- Wired camera → MediaPipe → pose → iris scale → confidence gate → One Euro filters → depth mesh → GLB renderer in `try-on-web`.
- Added deterministic build-time calibration-proxy GLB generation; it is explicitly not J1-M and is not recommended for live product use.
- Added SHA-256-pinned provisioning for the official Face Landmarker model and official portrait fixture.
- Added a camera-free browser self-test. Local evidence: 478 landmarks, tracking state, high scale confidence, visible calibration GLB, and zero external runtime requests.
- Fixed browser packaging boundaries for shared compiled packages, `.mjs` MIME, and the complete Three.js module graph.

### `JSC-0205` / `JSC-0206` external-input tooling

- Added a fail-closed J1-M intake contract for measurements, six required source views, SHA-256 provenance, approved immutable GLB metadata, attachment matrix, and live QualityEnvelope.
- Added actual-wear placement annotation contracts with pseudonymous subject ID, source-image hash, consent reference, actual/rendered landmarks, jitter, tracking success, and FPS.
- Added deterministic bridge, width, lens-center, roll, and quality-gate report derivation plus CLIs.
- The committed templates intentionally report `ready: false`; no J1-M values or human evidence have been fabricated.

### G1 reliability and operational hardening

- Added the pure `RuntimeLifecycle` reducer for camera, model, tracking, denial, unsupported, and error transitions.
- Added constant-memory runtime performance traces for initialization, first detection/render, and aggregate detection/render duration.
- Made camera start/restart/stop generation-safe: stale permission results cannot reactivate a stopped session, old tracks are released, ended tracks fail closed, and denied sessions can retry.
- Added background/page-hide camera shutdown and in-flight runtime initialization cancellation.
- Added WebGL context loss/restoration handling and preserved the current GLB when a replacement asset fails to load.
- Added `nosniff`, referrer, camera permissions, and same-origin resource delivery headers to the local delivery boundary.
- Re-ran the camera-free browser self-test with performance evidence after hardening; the physical/device limitations are unchanged.

### G1 source acquisition boundary

- Added fail-closed `SourceAsset`, `MeasurementSet`, dimensional evidence, and `FrameCaptureDraft` contracts for unknown JSON input.
- Added real-file inspection for SHA-256, byte length, magic-byte MIME, JPEG/PNG dimensions, local path containment, and immutable private object keys.
- Separated a valid single annotated-image draft from G1 capture readiness. G1 still requires six distinct source roles and verified evidence for all five required dimensions.
- Added private-source ENV convention and intentionally incomplete candidate templates. Raw product photographs remain outside Git and public runtime delivery.
- Completed `JSC-0205B`: a strict authoring contract accepts exactly the five required field/source/value/raw-label records plus optional bounded regions, while rejecting author-supplied provenance and verification claims.
- Added pure inspected-source assembly and `frame:capture:author`; actual source bytes determine SHA-256/object keys, every image transcription is unverified, canonical draft output excludes mtimes, and command success is draft validity rather than G1 readiness.
- Added optional `--output-path` local-private draft persistence gated on an explicitly configured existing private root. Canonical `0600` bytes publish through an exclusive temporary file and atomic no-clobber hard link, then are no-follow reread for the receipt's actual SHA-256/length; unsafe paths, symlink/non-directory parents and targets, collisions, and invalid roots fail closed with sanitized machine output. Stdout-only behavior remains compatible, while one-image output success still reports `g1Ready:false` and grants no verification, rights, promotion, publication, or G1/G2/G3 authority.
- Added source-pixel coordinate provenance: JPEG/PNG/WebP EXIF orientation and JPEG/PNG/VP8X/VP8/VP8L encoded geometry derive only from bounded actual-byte parsing. Stable drafts preserve encoded/display geometry and raw-encoded half-open integer semantics while omitting mtime. Orientation 2–8 and legacy geometry-less regions/manual traces fail closed; raw-label-only legacy data is the sole compatibility case. Capture-to-Proxy digests and strict durable bodies bind the referenced geometry. This proves coordinate interpretation, not transcription correctness, OCR, contour fidelity, physical accuracy, rights, product identity, or J1-M/G1/G2/G3 authority (ADR-0015).
- Automated evidence for this boundary: typecheck, 42 focused source/capture/Proxy tests, all 270 deterministic tests, the intentionally gate-not-ready quality template check, and clean diff validation pass.
- Proved with a generated temporary PNG that a valid annotated-overview candidate exits successfully while retaining actionable `g1Ready: false` blockers. The user's described private image remains undiscovered and has not been ingested or verified.

### `JSC-0207` external runtime catalog and GLB integrity

- Removed the hard-coded calibration asset from the live try-on path. Live startup now requires a configured catalog URL and optional SKU; adding another product is catalog data, not a TypeScript/HTML change.
- Kept the deterministic calibration proxy only in an explicit self-test catalog. The live path rejects fixtures and accepts only `published` assets whose QualityEnvelope is recommended for live use.
- Added fail-closed unknown JSON catalog/manifest parsing and a pinned trust chain over manifest actual bytes, GLB actual bytes, identity, source hashes, metre units, bounds, and required nodes.
- Added GLB v2 header/chunk, embedded BIN, accessor/bufferView, finite POSITION actual-byte bounds, active-scene reachability, and catalog frame-width checks.
- Removed verification/load TOCTOU by passing the exact verified ArrayBuffer to GLTFLoader instead of fetching the model URL again.
- Applied one origin allowlist to catalog, manifest, model, and redirects. Active Deployment proof remains a later control-plane boundary.
- Added positive published-asset and code-free second-product fixtures plus integrity/origin/status negative tests.

### `JSC-0208` deterministic tracking quality and runtime policy

- Replaced MediaPipe face-present confidence 1/0 with a pure deterministic estimator over canonical landmark completeness/finite values, in-frame ratio, pixel span, normalized temporal residual, and transform rotation/translation jump. Landmark visibility is diagnostic input only and does not affect confidence.
- Corrected ConfidenceGate to retain the first below-exit instant. Fake-clock regressions prove no-face and moderate-low opacity is nonzero at 249 ms and zero at 250 ms, while short dips, exit recovery, enter/reacquire hold, and hysteresis remain explicit.
- Added a generation/visibility-lease-safe SingleFrameRuntime watchdog for missing frames and asynchronously pending detection. Dispose hides synchronously, stale timers/results cannot render into restarted sessions, and only healthy visibility refreshes the lease.
- Added normalized quaternion YXZ head-angle extraction and raw-pose QualityEnvelope evaluation. Yaw/pitch, minimum-required scale confidence, and millimetres-per-pixel availability fail closed on the same frame before filtering.
- Added `public-live`, `qa-preview`, and `calibration` asset admission. Rejected public/QA assets stop before manifest/GLB model fetch where catalog metadata is sufficient, and all rejected assets stop before backend/WebGL initialization. JSC-0207 verified bytes remain the only renderer input.
- Runtime View now exposes deterministic reasons, raw YXZ angles, and asset quality tier; the renderer remains policy-free and applies final opacity faithfully.
- Automated evidence: typecheck and 106 deterministic tests. A parent-environment post-JSC-0208 browser rerun passed with 478 landmarks, tracking, medium scale confidence, runtime angle/tier diagnostics, zero external-origin requests, and watchdog `lost` / opacity `0` after frames stopped. Provisioned model/portrait files remain intentionally uncommitted.

### JSC-0209 Ground Truth evidence gate

- Added versioned, unknown-field-rejecting Ground Truth evidence contracts with pseudonymous tenant/subject/fixture identities; frame/variant/AssetVersion binding; actual asset/source/manifest/model/capture/render/trace hashes; actual-bytes verification metadata; runtime commit/config; deterministic consent retention; image/view/device metadata; in-image annotations; and matching provenance.
- Added view-aware placement metrics, normalized roll, yaw attachment, circular temporal jitter, motion lag, reacquire jump, lost latency, and mandatory non-vacuous motion/loss/reacquisition coverage. Per-fixture violations cannot hide behind medians.
- Added explicit `technical-single-frame-slice` tooling readiness and strict `canonical-validation` promotion profiles. Canonical requires exact 45 cells, five unique device classes, full visual review, 3/10-minute sustained performance checkpoints, and operational scenarios. `metricPass`, `gateReady`, and `canonicalPromotionReady` are separate.
- Added machine-readable CLI/reporting and an intentionally rejected canonical authoring template. Raw actual-wear media remains outside Git.
- ADR-0007 resolves the J1-M single-slice/canonical coverage, device, and visual enum conflicts without shrinking the stricter source requirements.
- No physical evidence was fabricated. JSC-0209 tooling completion does not change `G1_SINGLE_FRAME_RUNTIME_ACTIVE`; canonical `gateReady` remains false until actual J1-M, consented 45-cell, and live-device evidence is supplied.
- Automated evidence: typecheck, 125 deterministic tests, fail-closed canonical template check, and clean diff check pass.
- The watchdog guarantee assumes browser event-loop progress. Synchronous main-thread MediaPipe blocking cannot be preempted by a timer and requires the later Worker boundary for an absolute wall-clock guarantee.

### JSC-0210 signed active Deployment proof

- Added a versioned fail-closed Deployment payload contract for tenant/site/environment, exact one active selector, SKU/model/variant, immutable AssetVersion, revision/generation, activation/audit provenance, catalog/manifest/model hashes, HTTPS allowed origin, and prior deployment digest/receipt chain.
- Added a pure evaluator for document time/order, host minimum floors and maximum age/lifetime, document-wide active stream uniqueness, strict revision+generation advancement, idempotent exact-document reload, rollback-safe prior receipt matching, and host catalog-origin intersection.
- Public-live now has one application entry point. The generic catalog loader rejects public-live even when given a deployment-shaped plain object. The application verifies a bounded ES256 envelope with an immutable host `keyId → authorityId + P-256 public JWK` mapping before parsing exact payload bytes.
- Query parameters may select only an allowlisted deployment URL. They cannot select the trust key/hash, catalog, or SKU. The verified pointer binds catalog actual bytes through manifest and GLB actual bytes; each is fetched once and the renderer receives the exact verified GLB ArrayBuffer.
- Public-live requires a Web Locks-serialized localStorage receipt store with re-read compare-and-set. The scope key is an unambiguous JSON tenant/site/environment tuple; commit conflict prevents the loader from returning an asset. QA preview and calibration retain explicit separate paths.
- Production deployment/catalog origins require HTTPS. Safari 15.4 is the local-authority public-live minimum; Safari Lockdown Mode disables Web Locks and therefore fails closed without a silent fallback.
- Deterministic tests use a fixed, explicitly test-only/non-production P-256 identity. No production key, signature, deployment event, authority, or activation evidence was created.
- Automated evidence: typecheck and 143 deterministic tests pass. This proves tooling/integrity readiness only. A new browser remains bounded by host floors plus signed expiry/maximum age/lifetime; absolute replay prevention requires an external online freshness authority and is not claimed.
- A parent-environment camera-free browser rerun passed with the locally reused official model/portrait bytes whose hashes match the repository pins: 478 landmarks, tracking, medium scale confidence, proxy-tier diagnostics, zero external-origin requests, and watchdog `lost` / opacity `0`. The child sandbox's localhost restriction was environmental and is not recorded as a product failure; the ignored model/portrait bytes remain uncommitted.

### Tracking Worker boundary

- Added `jessica.tracking-worker` protocol v1 with fail-closed exact-field parsing for init/frame/result/no-face/error/dispose, session/generation/request IDs, strict integer-microsecond timestamps, resource pins, transfer contract, and bounded diagnostics.
- Public-live now constructs only a Worker tracking backend. A minimal same-origin classic bootstrap preserves MediaPipe Tasks Vision 1.0.1 `importScripts` WASM-loader compatibility, buffers the init message until the Jessica ES-module graph is ready, and keeps MediaPipe initialization plus synchronous `detectForVideo` inside the Worker. Missing Worker or `createImageBitmap` support fails closed without an in-process fallback.
- Avoided reliance on document import maps by dynamically importing an explicit same-origin self-hosted MediaPipe module URL. The Worker fetches the pinned model once without credentials/cache, bounds the stream by exact Content-Length/byte length, verifies final redirect origin and actual SHA-256, and initializes from the verified buffer.
- Enforced one inference in flight plus one latest queued frame, deterministic drop counters, timestamp-order preservation even when bitmap creation completes out of order, complete plain-result validation, generation/result ordering, and stale suppression.
- Defined exact transfer ownership and close/release behavior for success, no-face, malformed input/result, post failure, detection error, timeout, queued drop, dispose, crash, and restart. Hung inference is terminable; restart creates a new generation.
- The independent UI visibility lease still hides at exactly 250 ms while Worker inference is pending and rejects late results. This assumes UI event-loop progress; another same-thread timer still cannot absolutely preempt a UI event-loop stall.
- Automated evidence: typecheck and 162 tests pass, including protocol/fake-Worker/packaging/origin coverage. A parent-environment camera-free real-browser rerun passed with the independently reverified ignored model/portrait bytes: 478 landmarks, 3/3 Worker frames/results, scale medium, Worker errors 0, external origins 0, runtime opacity 1, then watchdog `lost` / opacity `0`. No physical/device, J1-M, or G1 PASS is claimed.

### `JSC-0301`–`JSC-0303` G2 design-assistance boundary

- Added a versioned, unknown-field-rejecting representative inventory contract for one tenant and exactly 20 distinct FrameModels with explicit variants, cross-tenant/anti-relabel identity/source rules, commercial rationale, traits, rights, source/measurement readiness, and immutable source provenance. The pure coverage evaluator allows honest overlap across all nine roadmap traits while keeping representativeness, rights, capture readiness, synthetic status, and final selection separate.
- Added a versioned capture-jig contract for jig/camera profile, exact front/±15°/±25° roles, lighting/background, scale marker, caliper/angle gauge, naming, actual calibration hash/bytes/provenance, checklist, and replay metadata. Specification validity, physical calibration, and run readiness are separate; unsupported physical tolerances remain explicit nulls for human calibration.
- Added strict Proxy/Standard and three-model Premium baseline evidence plus optional Commercial Reference, single-tenant binding, same-input comparison integrity, unique input/output/model/render artifacts, post-run human review, supported-mobile performance, and size/correction/approval/failure evidence. Document validity, 43-cell completeness, inclusive metrics, strict stop signals, and G2 strategy-selection readiness are separate.
- Added fail-closed CLIs, operational protocols, comprehensive deterministic boundary tests, and committed `fixtures/g2/` inputs that are exclusively synthetic/templates.
- Automated evidence: typecheck and all 193 tests pass. The default inventory, jig, and bakeoff checks each exit 1 with structured fail-closed reports; malformed/missing inputs exit 2 with sanitized JSON and no path/stack disclosure; clean diff validation passes.
- This prepares tooling only. No real representative products, rights, physical jig calibration, manual baseline, commercial comparison, mobile measurement, or human review was created. `G2_GENERATION_STRATEGY_SELECTED` is neither ACTIVE nor PASS, and current gate remains `G1_SINGLE_FRAME_RUNTIME_ACTIVE` with unchanged external blockers.

### Wave C deterministic explicit-profile Proxy boundary

- Moved the GLB v2/header/chunk/embedded-buffer/accessor/active-scene/actual-POSITION/metre-bounds checks from the web loader into `packages/assets`; runtime catalog and generation now use the exact same validator.
- Added `packages/frame-generation` strict schema v1 parsing for candidate identity, sorted immutable source hashes, measurement identity and six required mm dimensions, generator identity/version/config digest, paired outer/inner lens polygons, bridge anchors, and hinge anchors.
- Added deterministic hole-aware front rims, bridge, and left/right temple GLB generation. The only mm-to-metre conversion occurs at geometry construction; generated actual bounds are checked against frame width and temple length.
- Added content-addressed GLB/manifest output carrying canonical input, measurement/source/generator/output provenance, actual bounds, required nodes, limitations, and fixed `draft` / `proxy` / `recommendedForLive: false` / calibration-only authority.
- Added an explicit-local-output CLI that refuses overwrite/collision and sanitizes errors, plus a visibly synthetic template and focused deterministic/fail-closed/runtime-compatibility tests.
- Parent integration hardening made GLB Float32 serialization explicitly little-endian, added strict connector-safe outer/inner point ordering, sanitized untrusted validation paths from CLI output, and made partial-write cleanup cover both files created by one invocation.
- Shared GLB bounds now derive only from active-scene reachable meshes while all declared geometry remains structurally checked; non-triangle modes and decoded out-of-range indices fail closed.
- Final shared-kernel hardening rejects matrix/TRS on reachable mesh nodes and mesh-affecting ancestors while preserving validated transform-only anchor leaves. Indexed and non-indexed triangle element counts must be divisible by three, closing render/bounds and incomplete-triangle bypasses.
- Automated evidence: typecheck and all 210 tests pass, including focused generator/CLI/shared-kernel/runtime-catalog regressions. The canonical promotion template remains fail-closed and `git diff --check` passes.
- This is explicit-profile/parametric Proxy preparation only. No image was found or processed; no bytes, OCR, dimensions, masks, or provenance were invented. No product/J1-M asset, contour fidelity, physical approval, G1 readiness, G2 ACTIVE/PASS, Cloudflare mutation, QA-preview, or public-live claim is made.

### Capture-draft to Proxy authoring provenance bridge

- Added a pure schema-v1 fail-closed bridge from strict `FrameCaptureDraft` to
  the existing deterministic Proxy generator input. Tenant/model and sorted
  source hashes derive only from the validated draft; callers supply only
  variant/asset candidate identity, generator identity/config, thickness
  provenance, and explicit profile authoring.
- Closed the five-to-six dimension gap without a default. Thickness is either
  source/raw-label/half-open-integer-region-bound unverified image/marking
  evidence or an explicitly non-physical assumption with reason, bounds, and
  limitations. Caller-asserted caliper/verified escalation is rejected pending
  a separate trusted verification artifact.
- Added deterministic no-contour-fidelity dimension-template authoring and
  source-SHA/region/integer-pixel/coordinate-rule-bound manual trace authoring.
  Unbound millimetre polygons fail closed; generated polygons still pass the
  existing strict correspondence/anchor/dimension checks.
- Bridge-authored legacy-compatible Proxy v1 inputs carry strict durable
  `authoringEvidence`. Complete thickness provenance and discriminated
  template/manual-trace bodies are canonical-input/GenerationJob-bound and
  copied into the manifest. The generator recomputes profile evidence digest and
  derived mm geometry; assumption limitations remain visible in the manifest.
- Required measurement and evidenced-thickness labels must contain an ASCII
  numeric token equal to their `valueMm`; decimal and composite marking syntax
  is covered without making any OCR or image-interpretation claim.
- Added ADR-0013 and a visibly synthetic/non-product fixture. At that wave no
  machine CLI was added; the later ADR-0027 transaction now supplies the missing
  private capture-to-Proxy filesystem boundary.
- Automated evidence: typecheck, focused capture/generator/job/Worker/QA/runtime
  suites, all 256 deterministic tests, `quality:evidence:template-check`, and
  clean diff validation pass.
- A later local-only run found and actual-byte inspected the prepared non-J1-M
  candidate archive. Its annotated values were transcribed as unverified product
  labels and produced a private draft/calibration Proxy. Raw bytes, identifiers,
  hashes, paths, and receipts remain outside Git. The run established no contour,
  physical verification, product identity, J1-M, rights, actual-wear, QA-preview,
  publication, Cloudflare/R2, or G1/G2/G3 claim.

### Wave D/D3 private CaptureDraft-to-Proxy input transaction

- Added `frame:proxy:input:author`, the ADR-0027 private filesystem adapter for
  deriving a complete Proxy generator input from a stored `FrameCaptureDraft`
  without manual hash copying or printing private evidence.
- The three-field operator envelope can name only a private-root-relative draft
  and strict authoring choices. Source, measurement, profile, and input digests
  are recomputed. Output is canonical, exclusive, no-follow, no-overwrite,
  verified `0600` bytes below the configured private root.
- The generator accepts the authored wrapper only after strict canonical digest,
  provenance, fixed method-limitation, and non-promotable authority verification.
  This proves structural/replay consistency, not cryptographic origin or operator
  authentication.
- The real private candidate run produced a GLB whose shared validator confirmed
  required nodes, metre units, and manifest-bound bounds. It remains a
  dimension-template approximation with `draft`/`proxy`/
  `recommendedForLive:false`/calibration-only authority.
- Automated evidence: typecheck, all 435 deterministic tests,
  `quality:evidence:template-check`, dependency audit with zero vulnerabilities,
  and clean diff validation pass.

### Wave D/D3 GenerationJob v1 local evidence boundary

- Added fail-closed unknown-input GenerationJob request/event v1 contracts for tenant/model/method, generator identity/version/config digest, sorted immutable source set, measurement and generator-input digests, explicit policy/timestamps, attempts, exact statuses, worker claim/lease evidence, retry classification, and output manifest/model hash plus byte-length evidence.
- Processing identity and idempotency are canonical across source ordering, submission time, and retry-policy changes; actual processing-input mutations change identity. Submission time and retry policy remain committed in the queued event.
- Added a pure allowed-transition reducer and replay-only state derivation. Strictly increasing event time/sequence, bounded attempts, queued-only claim, exact owner/token binding, maximum 15-minute lease, deterministic expiry recovery, retryable-only retry, cancellation, terminal immutability, and review-output equality fail closed.
- Every event binds previous digest, canonical event digest, and complete job identity. Replay requires an explicit `evaluatedAt`, permits that horizon to fall inside a valid bounded active lease, and rejects missing, reordered, duplicate, altered, future-event, stale, cross-tenant/model/input, status-relabelled, and output-substituted evidence.
- Added a local-only Frame Factory CLI/store with component-by-component symlink rejection before directory creation, explicit root/relative output/evaluation cutoff, one atomic sequence CAS slot containing canonical digest-bound bytes, exclusive temporary writes, exact-byte idempotency, competing-claim collision refusal, cleanup, and sanitized machine JSON.
- Added ADR-0011 and a visibly synthetic/non-promotable request template. Proxy output hashes can reach review evidence only; no Worker execution, UI, Supabase/R2/Cloudflare/network mutation, approval, publication, deployment, Standard/Premium generation, or G1/G2/G3 pass is created.
- Automated evidence: typecheck, focused GenerationJob/CLI suites, all 223 deterministic tests, and clean diff validation pass. The local sequence CAS ignores only its own strict UUID-shaped regular pending files, preventing concurrent readers from misclassifying an in-flight atomic write while all other unknown entries still fail closed.

### Wave D/D3 local proxy-auto Processing Worker v0

- Added a pure/application composition boundary that accepts only an existing
  queued `method=proxy-auto` job. The parsed strict Proxy input's actual canonical
  digest, tenant/model, sorted sources, measurement digest, and generator
  id/version/config must exactly match the queued processing request before any
  claim is attempted.
- The local worker claims through the existing immutable sequence CAS, generates
  into an explicit contained root, rereads actual manifest and GLB bytes, hashes
  and measures them independently, reconciles manifest/GLB URL/hash/length and
  complete provenance, then applies the shared runtime-compatible GLB kernel.
- Only exact verified evidence is appended as `output-recorded`; the result is
  review with fixed fixture/draft/proxy/`recommendedForLive:false`/
  calibration-only authority. No completion, approval, publication, deployment,
  live admission, Standard/Premium, network, or cloud mutation exists here.
- Exact complete content-addressed output may be reused. Different or half-
  present output is preserved and rejected. Invocation-created partial output is
  cleaned; uncertain cleanup fails closed. Post-claim failure events use the
  documented terminal-versus-safe-retry table in ADR-0011, and CAS losers never
  create a second owner.
- The filesystem cannot atomically commit the output pair and ledger event.
  ADR-0011 documents exact replay, lease expiry/recovery, retry-queued, byte
  reverification, and `recoveryRequired` handling. There is no hidden clock or
  blind retry.
- Before claim CAS, the worker now requires a live synchronous explicit
  timeline: claim precedes output/failure, both result timestamps are at or
  before `evaluatedAt`, and `evaluatedAt` is strictly before lease expiry. This
  closes the backdated-work case where replay preserved a running state even
  though the newly proposed lease had already expired at the observation
  horizon.
- Containment/root codes are now classified before generic `TypeError`, so safe
  CLI/core failures remain sanitized terminal `OUTPUT_CONTAINMENT` or
  `ROOT_INVALID` instead of being mislabeled as identity failures. Required
  post-write rereads translate missing, symlink-swapped, and non-regular output
  to terminal `OUTPUT_VALIDATION`; no-follow prevents reading the symlink target,
  invocation-created paths are cleanup-proven, and failure evidence is recorded.
- Ambiguous claim hard-link completion is replay-resolved before output work.
  Exact published claim evidence continues safely, an unchanged prior head
  proves no claim, a competing head is contention, and an unreadable outcome
  returns terminal `CLAIM_COMMIT_UNPROVEN` with `recoveryRequired:true` rather
  than falsely reporting no mutation.
- Focused automated evidence covers happy review, deterministic reuse,
  cross-identity/config/input substitution, non-proxy methods, lease bounds,
  concurrent runners, actual-byte tamper/mismatch, partial I/O cleanup,
  failure classification, and path/symlink/privacy behavior. All inputs remain
  visibly synthetic/non-product/non-promotable; no G1/G2/G3 status changes.
- Automated evidence: typecheck, 13 focused Worker tests, 22 affected Worker/
  ledger/output-store tests, all 236 deterministic tests,
  `quality:evidence:template-check`, and clean diff validation pass.

### Private authored Proxy execution adapter

- Added `frame:worker:proxy-private`, which reads only a bounded/no-follow
  private-root-relative ADR-0027 authored wrapper, strictly recomputes the
  wrapper and its fixed authority, and delegates to the existing proxy-auto
  GenerationJob worker rather than duplicating generation or transition logic.
- Added private bundle publication that stages and syncs both complete `0600`
  inodes, publishes each final name with an exclusive no-replace hard link,
  rereads actual bytes/mode, rejects partial/different/permissive output, and
  removes only invocation-owned inodes on failure. Exact complete `0600` pairs
  remain reusable under the existing ADR-0011 recovery model.
- Canonical manifest serialization removes property-insertion-order dependence
  from deterministic output bytes. The sanitized adapter receipt exposes no
  candidate bytes, identities, paths, filenames, or hashes.
- The adapter reaches only GenerationJob `review` with fixed fixture/draft/
  proxy/`recommendedForLive:false`/calibration-only/non-promotable authority.
  It creates no QA decision, physical/J1-M claim, approval, publication,
  deployment, live admission, or G1/G2/G3 progress (ADR-0028).

### Private authored Proxy queued submission

- Added `frame:job:submit:proxy-private`, a submission-only adapter from one
  private-root-relative ADR-0027 wrapper to the canonical queued GenerationJob
  event. Its only additional inputs are a private ledger locator, a 1..10 retry
  bound, and creation time.
- Tenant/model, generator/config, source, measurement, canonical input, job,
  idempotency, and event identities are recomputed by the existing strict
  verification and GenerationJob kernels; none can be supplied by the caller.
- Wrapper reads are bounded/no-follow, private ledger directories are real
  `0700` components, sequence-one publication is exclusive `0600`, and exact
  duplicates converge through the existing immutable CAS and replay kernels.
  Traversal, symlink, permissive, tampered, relabelled, colliding, and unproven
  states fail closed without overwrite.
- Ambiguous writer exceptions now resolve through one read-only ledger reread
  and replay: only the exact canonical queued sequence-one outcome recovers as
  bounded idempotent success; an unchanged empty ledger preserves the confirmed
  writer failure, while different, malformed, or unreadable outcomes are
  append-unproven. Resolution performs no retrying write, claim, generation, or
  worker invocation.
- Ordinary writer success also requires the same exact reread/replay; a missing,
  unreadable, or non-exact verification result is never reported as success.
- Receipts contain no candidate identities, locators, filenames, or hashes and
  remain local-evidence-only/non-promotable with `processingStarted:false`.
  Submission never generates or processes; the ADR-0028 Loop29 worker remains
  the separate queued-ledger consumer (ADR-0029).

### Wave D1 fail-closed QA decision / AssetVersion draft boundary

- Added schema-v1 canonical SHA-256 QA decision evidence with exact
  tenant/model/job/processing-input/review-head/manifest/model hash and actual
  byte-length binding, pseudonymous reviewer identity, explicit
  `reviewedAt`/`evaluatedAt`, bounded sorted issue categories, and bounded notes.
  Unknown fields, altered or substituted evidence, future/stale evidence, and
  absent/duplicate/multiple/reordered terminal decisions fail closed.
- Approve and reject are explicit distinct human decisions; there is no
  auto-approval path. Reject derives no asset. Proxy approve only derives the
  exact reviewed immutable calibration draft and never an `approved` asset.
- Asset identity/version/variant, content-addressed model/manifest URLs, hashes,
  byte lengths, sources, generation/job provenance, identity attachment,
  zero-angle non-live envelope, and status are deterministic from the verified
  job and Proxy input. Caller relabel/status escalation is not accepted.
- Physical, visual-fidelity, actual-wear, and rights requirements remain
  explicit `false` with evidence digests `null`. Derived output is fixed to
  fixture/`draft`/`proxy`/`recommendedForLive:false`/calibration-only/
  `promotable:false` and is rejected by QA-preview and public-live admission.
- Kept the boundary pure: no extra persistence/CAS protocol, CLI, network,
  Supabase/R2/Cloudflare mutation, deployment, publication, or physical evidence
  is introduced. Concurrent identical derivations are deterministic.
- Automated evidence: typecheck, 11 focused QA tests, all 247 deterministic
  tests, `quality:evidence:template-check`, and clean diff validation pass.
- This remains preparation only. `G1_SINGLE_FRAME_RUNTIME_ACTIVE` is unchanged
  with the same physical J1-M, actual-wear, and five-class live-device blockers.
  `G2_GENERATION_STRATEGY_SELECTED` and `G3_FACTORY_25_ASSETS_PASS` are not active
  or passed.

### JSC-0211/0212 non-Proxy evidence and formalization-readiness boundaries

- JSC-0211 derives only a complete immutable non-Proxy evidence-candidate draft
  from an exact reviewed non-Proxy GenerationJob. Its four evidence references
  remain unverified and every QA/AssetVersion/live/publication authority is false.
- JSC-0212 rejects a caller-authored replacement summary, replays the canonical
  GenerationJob ledger and QA decision, and strictly re-parses the complete
  JSC-0211 candidate, including draft/admission/non-promotable state,
  frozen authority denials, source/MeasurementSet/job/output identity, attachment
  matrix and non-live QualityEnvelope.
- Added bounded actual-byte verification for the exact source set plus one
  measurement sheet, visual capture, consented actual-wear capture, rights record,
  model, manifest, GenerationJob ledger and QA decision. The verified-caliper
  document, manifest and GLB are structurally parsed; job/decision replay must
  derive the exact candidate. Kind-specific and aggregate limits, duplicate
  ID/digest rejection and actual SHA-256/length checks fail closed.
- Added exact ES256 attestation verification through a host-only
  `keyId → tenantId + authorityId + allowed scopes + public P-256 JWK` trust map
  and clock, separate from the request. Four independent public keys and
  authorities bind sorted actual artifact descriptors, complete candidate digest,
  tenant/model/variant/job/review/generator/source/MeasurementSet/output identity,
  issuance/expiry, consent retention and internal-review-only rights.
- Physical claims require six canonically ordered source-bound dimensions which
  exactly match canonical verified-caliper bytes. Marking transcription remains
  closed pending the separate marking-inspection boundary; reported absence is
  not an exemption and creates no verified dimensions.
- JSC-0212 does not accept caller-authored source-role labels. Source bytes are
  job/digest-bound with `sourceRole:null`; capture role and marking-surface
  semantics remain reserved for the separate provenance/inspection boundary.
- Even a fully signed actual-byte package yields only
  `evidence-package-verified-for-authorized-human-review-input` with a bounded
  validity horizon. QA approval, AssetVersion creation or
  promotion, live recommendation, Deployment, publication and every gate remain
  false. No filesystem, database, network, Cloudflare/Supabase or publication
  mutation is introduced (ADR-0030, ADR-0031).

### JSC-0213 marking inspection and verified source provenance

- Added versioned strict contracts for an independently signed canonical user-reported absence byte
  artifact, verified capture provenance, and closed-surface marking inspection.
  The report remains `reported-no-temple-marking`; it cannot self-promote into a
  policy result.
- JSC-0212 source artifacts remain actual-byte bound with `sourceRole:null`.
  Capture roles are derived only from an independent host-trusted ES256 payload
  that binds every exact candidate source descriptor, one specimen, and capture
  times. The inspection uses a different key and authority and binds the complete
  provenance payload digest.
- The immutable v1 policy covers exactly left-temple inner, right-temple inner,
  and bridge inner surfaces with distinct verified `marking` captures. Actor/time,
  actual report bytes, same candidate/source set/specimen, bounded evidence age,
  and a host-only expected supersedes head fail closed.
- All-surface absence derives only
  `no-dimension-marking-observed-under-policy` and makes only the marking
  transcription route not applicable. Any observed dimension marking keeps that
  route required. Both outcomes retain all six verified-caliper measurements and
  J1-M/G1 marking source requirements.
- The result denies QA approval, AssetVersion creation/promotion, live
  recommendation, Deployment, publication, and all gates. It performs no local
  persistence or remote mutation (ADR-0032).
- Automated evidence: typecheck, 33 focused regression/adversarial tests, all
  481 deterministic tests, the intentionally-not-ready quality evidence template
  check, and clean diff validation pass. Dependency audit could not reach the npm
  advisory endpoint in the restricted environment and is not represented as a
  pass.
- The private A3893_S9 photographs are user-confirmed real-product photographs,
  and the user reports no temple marking. They still lack the authorized signed
  same-specimen/capture-role/closed-surface evidence required by JSC-0213, so no
  positive policy result or G1/G2/AssetVersion/publication PASS is claimed. The
  archive, private bytes, and `.env` were not committed.

### JSC-0214 calibrated measurement provenance composition

- Added strict canonical actual-byte v1 contracts for one caliper calibration
  record and one atomic measurement session. Dedicated artifact kinds, bounded
  bytes, actual SHA-256/length, unique IDs/digests, and `sourceRole:null` prevent
  source images or existing evidence from being relabelled as sessions.
- The signed session admits only
  `direct-physical-caliper-observation`. Annotated images, marking transcription,
  reported/user absence, inferred values, and assumed thickness are outside the
  contract. Exactly six canonically ordered observations must be `mm`, use one
  observation instant, and exactly match the JSC-0212 document's values, source,
  method, authority, key, and host-JWK fingerprint.
- The evaluator synchronously snapshots the complete nested inputs before its
  first asynchronous operation, then internally re-evaluates the raw JSC-0212
  and JSC-0213 requests with host-only trust, clock, and lineage. Cached caller
  readiness/results cannot be supplied. Candidate/job/source/MeasurementSet and
  JSC-0213 specimen/capture provenance must match exactly.
- Calibration and measurement use independent tenant-scoped ES256 authorities,
  key IDs, and recomputed public-key fingerprints. Calibration must predate,
  cover, and remain valid for every observation and evaluation, with separate
  host limits for observation and calibration age.
- A valid composition yields only the frozen digest result
  `caliper-provenance-verified-for-authorized-human-review-input`. QA approval,
  AssetVersion creation/promotion, live recommendation, Deployment, publication,
  and every gate remain false (ADR-0033).
- Repository fixtures are synthetic only. No authorized A3893 calibration or
  physical measurement session exists in the repository, no private bytes or
  `.env` are committed, and no G1/G2/AssetVersion/publication PASS is claimed.
- Automated evidence: typecheck, 9 focused JSC-0214 adversarial tests, all 490
  deterministic tests, the intentionally-not-ready quality evidence template
  check, clean diff/private scans, and the parent environment dependency audit
  (`npm audit --omit=dev`, zero vulnerabilities) pass.

### JSC-0215 authenticated non-Proxy human QA decision

- Added a strict canonical ES256 v1 terminal human decision contract using the
  existing QA/SQL `approve | reject` enum and closed sorted issue categories.
- The evaluator snapshots with cycle detection before its first await and then
  internally re-evaluates the complete raw JSC-0212/JSC-0213/JSC-0214 requests.
  Benign repeated aliases are independently copied; true recursive cycles,
  hostile descriptors/prototypes, oversized structure, and post-call mutation
  fail closed. Caller-cached readiness/results, clocks, trust, lineage,
  projections, AssetVersions, and review-ready timestamps are not accepted.
- The signed decision binds exact candidate/model/variant/version, GenerationJob
  lineage/output, source set, MeasurementSet, specimen, every composed result and
  payload digest, input validity horizon, internal-review-only rights, terminal
  decision/issues/envelope, and review/issuance/expiry times.
- Calibration and measurement attestation payload digests are retained by
  JSC-0214 and signed by JSC-0215. A valid re-signing with changed issuance or
  authority provenance cannot reuse an earlier human decision merely because
  calibration-record and measurement-session bytes stayed unchanged.
- Stable composition hashes exclude host `evaluatedAt`; the clock remains only
  host verification input/evaluator output. The same still-valid signed decision
  can be replayed at a later honest host time with an unchanged payload digest
  while freshness and minimum-expiry checks are re-enforced.
- Effective validity is the minimum of signed reviewer expiry, upstream evidence
  validity, and the exclusive host maximum-review-age boundary; the result never
  advertises a horizon at which the same review would already be stale.
- Reviewer attribution is host-selected. Tenant, authority, reviewer ID, scope,
  key ID, fingerprint, and exact JWK must match one trust record. Reviewer
  authority/key/fingerprint reuse and same-JWK aliases are rejected across every
  formalization, report, capture, inspection, calibration, and measurement root.
- `reviewReadyAt` is recomputed from the replayed GenerationJob, the prerequisite
  earlier non-Proxy candidate decision, formalization attestations, marking
  report/captures/inspection, calibration/session/observation, and caliper
  attestations. Human review cannot predate the last prerequisite evidence.
- Approve derives only a deeply frozen
  `approved-non-proxy-review-projection` preserving candidate identity/version/
  URL/hash/source/generation/matrix/requirements. Its QualityEnvelope can only
  narrow yaw/pitch or strengthen minimum scale confidence and remains non-live.
  Reject derives neither a projection nor QA approval.
- Both paths keep AssetVersion creation/promotion, live recommendation, active
  Deployment, publication, and all gates false and perform no database,
  filesystem, network, catalog, deployment, or publication mutation (ADR-0034).
- Repository fixtures are synthetic. No authorized A3893 human decision exists,
  no private bytes or `.env` were touched, and no physical/G1/G2/G3/AssetVersion/
  publication PASS is claimed.
- Automated evidence: typecheck, 16 focused JSC-0215 adversarial tests (plus 10
  imported JSC-0214 regressions), all 517 deterministic tests, the intentionally-
  not-ready quality evidence template check, clean diff/private/secret/media
  scans, and the parent-environment dependency audit (`npm audit --omit=dev`,
  zero vulnerabilities) pass.

### Local Supabase/Postgres control plane and publication authority

- Added the data-free CLI-created migration
  `20260811071257_control_plane_publication_v1.sql`: 19 authoritative private
  tables cover normalized membership, tenant/site/product identities, inspected
  source/pixel provenance, measurement evidence, generation events, immutable
  AssetVersions, QA decisions, authority public identity, immutable signed
  Deployments/resources, exact-one publication-stream pointers, and append-only
  audit/publication evidence.
- Every private table has RLS enabled and forced with a normalized active-membership
  SELECT policy. The only definer helper is private, null-guards `auth.uid()`, has
  empty search path/qualified objects, revokes PUBLIC/anon/service-role execution,
  and grants only authenticated. Authorization uses no JWT metadata. The only
  exposable surface is two security-invoker API read views; there is no anon grant
  or exposed mutation RPC.
- SQL constraints and minimal triggers enforce tenant composite FKs, tenant-unique
  SKU, lowercase SHA-256, positive sizes/versions/dimensions, lower-case site domain,
  event-chain and source-geometry binding, append-only decisions/events/deployments,
  immutable asset bytes/URLs, non-promotable Proxy state, and published immutability.
- Publication authority is not catalog recommendation. Immutable URL/hash bindings
  and signed Deployment envelopes precede one stream pointer. Replacement and
  rollback both require an exact prior digest plus strictly higher revision and
  generation; synthetic verification produces activation/replacement/rollback
  events in an in-memory database only.
- PGlite 0.5.4 executes the production migration with test-only Supabase auth stubs
  outside it. Focused verification passes 60 SQL assertions across 19 forced-RLS
  tables, 19 policies, two security-invoker views, actual authenticated role switch,
  tenant isolation, constraints/immutability, and three publication events.
- No Jessica remote project exists and no unrelated Supabase project was inspected
  or mutated. No product, physical, approval, publication, deployment, actor, key,
  or gate evidence was created. G1 remains active/not ready; G2 and G3 remain
  inactive. Hosted advisors/RLS tests and every remote precondition remain pending.

## Active implementation objective

`JSC-0002_SINGLE_FRAME_RUNTIME`

Deliver a single-frame vertical slice for J1-M:

```text
camera
→ face tracking
→ pose adapter
→ scale resolver
→ confidence gate
→ One Euro filtering
→ depth-only face mesh
→ 3D frame render
```

## Non-negotiable constraints

- Face video and landmarks stay in the browser by default.
- All runtime eyewear assets are 3D GLB; quality tiers are asset-quality tiers, not separate renderers.
- Product metadata uses millimetres; glTF runtime geometry uses metres.
- Low-confidence tracking must fail closed rather than display a visibly detached frame.
- `tenantId` and replaceable catalog origin exist from the beginning; billing and full SaaS controls do not.
- No prescription-lens or medical-measurement claims in the initial product.

## Immediate next tickets

`JSC-0211_NON_PROXY_EVIDENCE_CANDIDATE` adds a strict, digest- and
GenerationJob-bound local hand-off for the four eventual non-Proxy evidence
classes. It derives only an explicitly unverified evidence-candidate `draft`, not
an AssetVersion; `fixtureStatus` remains unverified and its frozen authority object
denies QA approval, AssetVersion creation/promotion, live recommendation,
deployment, publication, and gates. It does not validate evidence bytes,
rights/consent scope, actual-wear identity, physical facts, human approval, or
G1/G2/G3 readiness. ADR-0030 records the boundary.

`JSC-0212_NON_PROXY_FORMALIZATION_READINESS` replays the complete JSC-0211
candidate from canonical job/decision bytes, verifies structured measurement,
manifest and GLB bytes, and verifies four host-trusted ES256 attestations. It
reaches only bounded authorized-human-review input eligibility and does
not create approval, an AssetVersion, publication, Deployment, runtime admission,
or gate progress. ADR-0031 records the boundary.

`JSC-0213_MARKING_INSPECTION_AND_SOURCE_PROVENANCE` verifies signed capture
roles and closed-surface inspection without changing JSC-0212 artifacts or
granting a measurement/source/gate exemption. Tooling is implemented; authorized
evidence for the private A3893_S9 specimen remains external. ADR-0032 records the
boundary.

`JSC-0214_CALIPER_MEASUREMENT_PROVENANCE_AND_FORMALIZATION_COMPOSITION`
re-evaluates the raw JSC-0212/JSC-0213 packages and composes them with strict
calibration-record and direct physical measurement-session actual bytes. The
implemented result is digest-only authorized-human-review input eligibility;
real authorized physical evidence remains external. ADR-0033 records the
boundary.

`JSC-0215_NON_PROXY_AUTHORIZED_QA_DECISION` re-evaluates that complete raw
composition and authenticates one host-selected independent human reviewer and
terminal `approve | reject` decision. Approve derives only an internal-review
projection with no live/publication authority; reject derives no projection or
QA approval. Real authorized evidence and reviewer input remain external.
ADR-0034 records the boundary.

`JSC-0218_NON_PROXY_QA_CONTROL_PLANE_PERSISTENCE` re-evaluates the complete raw
JSC-0215 request under host trust and produces only immutable, deterministic row
projections. The private forward-only v2 schema binds the signed terminal record,
active independent reviewer authority, exact variant/job/output/source identities,
verified MeasurementSet, validity/policy horizon, approved asset projection, and
internal-review-only rights. Reject is record-only. The terminal record
persists bounded `maximumReviewAgeMs`, its policy digest, and exactly derived
review-fresh/effective horizons, while SQL still cannot establish host-policy trust.
Standard/premium approval now
requires one exact unexpired approve binding; legacy `qa_review_decisions` is
insufficient, and a data-free cutover precondition refuses unexpected old
standard/premium approved/published rows. New tables are admin-only forced-RLS
relations with no policies, Data API surface, or mutation grants. SQL enforces
relational/transition truth but not ES256 trust, fingerprints, canonical digests,
or host policy truth. `approved` is historical evidence, not QA-preview/runtime/
catalog/publication admission. JSC-0219 must recheck binding, active authority,
and expiry. ADR-0037 records the boundary; every authority and G1-G7 claim remains
false and no remote or physical evidence exists.

`JSC-0218A_TRUSTED_NON_PROXY_QA_PERSISTENCE_WRITER` is the server-only execution
boundary for JSC-0218. Its public API accepts opaque authenticated actor/request
identity and the complete original raw JSC-0215 request only; trust, cryptographic
configuration, clock/policy, retry budget, and a typed database transaction port
remain private dependencies. It snapshots hostile input synchronously before the
first await and authenticates before opening one SERIALIZABLE transaction per
attempt. It snapshots the returned host trust context immediately, then acquires
canonical job/head, authority/key, and candidate session advisory locks on one
exclusive pinned physical connection before `BEGIN` or any snapshot statement.
Review/internal-asset/binding/source/approval validators take the applicable
authority -> candidate -> job transaction-advisory subset before authoritative
reads; any locator query obtains immutable IDs only and the authoritative state
is reread after locking. Generation-event and authority changes use the same job
and authority key families.
The adapter derives canonical GenerationJob output/current head, active
reviewer authority, exact unambiguous tenant/model/variant sources, verified
same-specimen MeasurementSet, and collision state from strict-parsed database
reads, then re-runs the raw evaluator in the transaction. It never accepts a
serialized plan, caller control snapshot/JWK/clock/SQL, or inspector result as
authority. Stored GenerationJob method, generator identity/version/config,
MeasurementSet digest, sorted source set, generator-input digest, max-attempt
policy, creation instant, and processing identity must all equal the replayed
genesis request and candidate selection. Query rows are detached/frozen in their
first continuation under one aggregate transaction budget.

Reviewer-authority registration is external; this writer requires one
pre-existing exact active authority and cannot insert it. Reject persists only
the terminal review fact. Approve writes the terminal review, an initially
review/internal-only AssetVersion, sorted exact
sources, and binding before the approved transition. Exact retry and final
readback reconstruct and compare all canonical fields and the shared signed
payload; final database-clock head/authority/expiry checks precede commit. Bounded
serialization retries reuse only the immutable initial raw snapshot with fresh
database state/time. A rejected lock-acquisition query, failed unlock/reset, or
unknown BEGIN/COMMIT/ROLLBACK outcome permanently discards the physical lease;
discard awaits a real close/destroy attempt and never repools, even on close
failure. The transaction provider rolls back rejected callbacks. After callback
completion, non-conflict host/port/check-in errors are commit-ambiguous and exact
recovery uses a fresh lease. Mutation and read-only recovery share one tracked
transaction boundary: unknown recovery BEGIN, lost recovery COMMIT ACK, a
callback error replaced by a distinct rollback/provider error, and post-callback
failure all discard/nonreuse the physical lease. Only the callback's exact error
after confirmed rollback may preserve it. Unknown commit outcome remains closed unless an independent
exact reread proves `recovered-exact-commit`. The deeply frozen receipt contains
only bounded IDs, digests, decision, committed time, and disposition and is not
JSC-0219 authority. The committed time is the persisted canonical transaction
timestamp, so exact retry and recovered acknowledgement reproduce it. V3 bounds
GenerationJob `max_attempts` to 1..64 and derives the complete-ledger replay
budget from that committed policy.

The final database-clock check is the adapter's last awaited precommit operation,
after receipt hashing and fault hooks. Transaction-local search path, lock,
statement, and idle timeouts are fixed. Cancellation at that boundary remains
`CANCELLED`, including exact retry; hostile signal accessors are never invoked.

The generated forward-only v3 boundary adds the minimum trusted job-output and
same-specimen identity support plus one credentialless, membership-free,
exact-object-grant `NOLOGIN NOINHERIT NOBYPASSRLS`
`jessica_non_proxy_qa_writer` group role. Forced RLS has explicit writer-only
policies on exactly nine SELECT relations, four INSERT relations, and one UPDATE
surface (33 private policies total); PUBLIC/anon/authenticated/service_role gain
no new JSC-0218A mutation policy or grant. The pre-existing 19 authenticated
member-read policies and authenticated `private.is_tenant_member(text)` EXECUTE
remain. Candidate terminal identity is unique across GenerationJobs and the
terminal-review validator shares its candidate lock for writer and owner/admin paths.
Role-aware invoker guards reject ordinary drafts, unrelated transitions, and
arbitrary review/source/binding writes. PUBLIC/API/service/writer roles have no
inherited EXECUTE on new or replaced writer-path helpers. No RPC/SECURITY
DEFINER, password, LOGIN, membership, browser/Data API, service-role,
default/future, or remote grant is added. ADR-0038 records the decision.
The verifier pins all 13 exact validator advisory expressions, including field
operands, length prefixes, ordering, and seed 218, and catalog-snapshots all 10
enabled validator/guard `BEFORE ... FOR EACH ROW` trigger definitions and
invoked functions.

The writer role is trusted-server TCB infrastructure, not DB-side ES256
authentication. Compromise of a future production LOGIN/parent membership could
submit attacker-selected digest/signature bytes; the supported application path
continues to raw-evaluate, verify ES256, and fully reread. Session unlock/reset
failure discards the physical lease and, after commit callback success, enters
commit-outcome recovery. At the JSC-0218A slice, PGlite exercised this contract
locally and real PostgreSQL pooled-session behavior had not yet been tested.
JSC-0220 later supplied the dedicated `pg.Pool` and PostgreSQL 17.11 evidence;
it does not turn the database into an ES256 verifier or a production host.

The final rejection audit separates catch presence from the rejection reason in
lock/session cleanup and tracked transaction state. `Promise.reject(undefined)`
at lock, callback, transaction, post-commit, unlock/reset, or recovery boundaries
therefore remains closed, discards whenever the boundary is ambiguous, and never
returns an undefined success or reuses a discarded lease.

Third-loop local verification passed `npm ci`, typecheck/build, 30 top-level
writer-file cases with four nested recovery-boundary cases plus 26 transitively
imported fixture-dependency cases (60 registered),
the separate DB wrapper case, v1 -> v2 -> v3 migration verification with 60 v1
and 170 v3 assertions, the 667-test full suite, the G1 evidence-template truth
check with `expectedGateReady: false`, `git diff --check`, secret/private-
media/debug scans, and `npm audit --audit-level=low` with zero vulnerabilities.
At that JSC-0218A verification point no local `psql`, `pg_isready`, Supabase CLI,
Docker, or database connection environment was available. The later JSC-0220
GitHub Actions job closes the selected provider/real-PostgreSQL acceptance gap;
no remote Supabase operation was attempted.

The control-plane sequence is now `JSC-0218` pure projection/v2 invariants ->
`JSC-0218A` trusted transactional writer/v3 support -> `JSC-0219` distinct
authenticated time-bounded committed-review QA-preview capability. JSC-0218A
adds no real row or evidence: no A3893 private bytes, J1-M physical evidence,
temple marking, QA-preview/runtime/catalog/publication/deployment/live admission,
G1/G2/AssetVersion publication authority, or G1-G7 PASS exists.

`JSC-0219_COMMITTED_REVIEW_QA_PREVIEW_CORE` now implements a process-local
server-side issuance/use scaffold. It authenticates strict tenant/actor/
reviewer/session/scope at issue and use, burns capabilities before the first use
await, and independently rereads exact committed approve/binding/asset row
digests, active reviewer authority, GenerationJob current output/head, exact
variant, verified same-specimen MeasurementSet, sorted sources, and DB-clock
expiry under a typed authority -> candidate -> job locked transaction contract.
Its final full reread followed by `clock_timestamp()` is the last awaited DB
operation. JSC-0218A receipts, serialized plans, caller claims, clocks, URLs,
origins, SKUs, and hashes are inadmissible.

Capability identity is stored per service instance, burned before the first use
await, and cannot be consumed by another instance. Successful use returns only
deeply frozen diagnostic eligibility with runtime and QA-preview runtime
authority false. The browser imports no mint factory, permit consumer, dedicated
QA loader, or QA proof. The generic loader rejects `qa-preview` before any fetch.
ADR-0039 records the decision.

This is not production-complete JSC-0219: process-local capability identity
cannot cross HTTP. The concrete pinned PostgreSQL reader, dedicated `pg.Pool`
provider, and required-by-design PostgreSQL 17 two-session acceptance now exist.
Authenticated signed/online one-shot transport, runtime integration, production
host pool/TLS/credentials/application role, and remote Supabase mutation remain
open; no real QA-preview availability claim was made.

## JSC-0221 signed QA-preview transport foundation

- The server-only transport foundation accepts a strict browser correlation
  request containing only a cryptographically random 64-lowercase-hex
  `requestId` and the exact tenant/AssetVersion selection. Authentication,
  reviewer/session identity, CSRF, and other host trust stay in a separate
  opaque trusted request context and are never browser JSON fields.
- The issuer reauthenticates around the JSC-0219 committed-review issue/use
  recheck and signs an audience-, actor-, reviewer-, session-, selection-, four
  row-digest-, committed-review-horizon-, and time-bound ES256 grant. Serialized
  and syntax-parsed grants are explicitly unverified evidence with no runtime
  authority. Only the server verifier may create the internal
  `qaPreviewRuntime:true` command, after signature and key verification, exact
  authentication/time checks, an atomic one-shot claim, and a fresh JSC-0219
  database recheck.
- Strict construction rejects duplicate key IDs, aliases of the same P-256 key,
  noncanonical JWKs/signatures/audiences/IDs, hostile descriptors, relabelling,
  stale review horizons, replay, and JSC-0218A receipts. The in-memory replay
  store is a reference only. A store rejection denies the current attempt but
  cannot prove a durable tombstone; ambiguous-outcome recovery and production
  one-shot durability remain JSC-0221B PostgreSQL work.
- No browser bundle/parser-to-runtime bridge, private manifest/model delivery,
  production authentication/CSRF/TLS/key operations, durable PostgreSQL replay
  provider, remote row, QA-preview availability, or public-live authority is
  claimed. The generic browser `qa-preview` loader remains zero-fetch closed.
  A3893 remains unverified source material and adds no physical, same-specimen,
  marking-surface, caliper, actual-wear, device, J1-M, or G1-G7 evidence.

### JSC-0221A1 bounded artifact container and verified-byte hardening

- Added the strict, explicitly unverified `JQAPB001` container profile: a
  20-byte header, big-endian envelope/manifest/model lengths, exact canonical
  sections, no trailing bytes, and 64 KiB/256 KiB/32 MiB limits. Its envelope
  binds the transport payload, a dedicated bundle-signer identity, artifact
  hashes/lengths/content types, and a URL-free approved non-fixture runtime-asset
  projection. This slice validates signature syntax only; it does not sign or
  cryptographically trust a response and remains `browserRuntimeUsable:false`.
- Bundle artifact inspection requires exact selection/source/manifest/model
  bindings and the inert `./model.glb` locator. Shared GLB validation now rejects
  every external `uri`, data URI, extension surface, and over-complex JSON
  before established geometry validation, preventing Three.js subresource fetch
  from otherwise verified private bytes.
- Independently hardened existing public-live assets: verified GLB bytes remain
  loader-owned and every caller receives a new copy; the verified GLB object and
  runtime-asset object must retain exact loader identity, while source hashes,
  attachment matrix, and quality envelope are snapshotted and frozen. Caller
  byte mutation or structural replacement can no longer alter a proved render.
- Still open: the fresh JSC-0219 internal artifact binding, private byte-source,
  actual bundle signing and response handler, browser pinned-key verification,
  one-shot opaque handle/runtime admission, whole-operation deadline, and
  JSC-0221B durable replay store. No deployed QA-preview or physical gate PASS
  follows from this container.

1. `JSC-0205` J1-M measurements, six source views, normalized GLB, attachment matrix, and QualityEnvelope
2. `JSC-0206` canonical 3 people × 5 frames × front/left/right actual-wear evidence
3. canonical five-class live-camera/device evidence

These remaining tickets require external physical product, consented actual-wear, or live-device input. The candidate sunglasses image may exercise the source/dimension draft path but cannot replace the six-view J1-M source set, actual-wear evidence, or device evidence.

## External dependency note

MediaPipe and Three.js are pinned, self-hosted, and exercised through the Worker by the camera-free parent-browser self-test. Physical J1-M inputs and the canonical five classes—representative iPhone Safari, lower-end iPhone/SE, mid-range Android Chrome, Windows Chrome, and Windows Firefox—remain external G1 requirements.
