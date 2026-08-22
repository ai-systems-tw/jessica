# ADR-0040: Authenticated one-shot QA-preview transport foundation

## Status

Accepted for the JSC-0221 server-side foundation and bounded bundle-container
sub-slice. Private asset-byte loading/signing orchestration, browser signature
verification, one-shot object-identity proof, and runtime integration remain
open.

## Context

ADR-0039 deliberately keeps its committed-review capability in a process-local
`WeakMap`. Its serialized eligibility is diagnostic and grants no runtime
authority. Passing that object, or a JSC-0218A persistence receipt, to a browser
cannot authorize QA-preview. A deployable path needs a non-client-mintable,
audience-bound, short-lived, single-use boundary while retaining every
committed-review revocation and drift invariant at the moment of use.

## Decision

JSC-0221 defines an exact, unknown-field-rejecting v1 request and an ES256-signed
v1 transport grant. The serialized browser JSON request contains exactly a
browser-generated correlation `requestId` and an exact tenant/AssetVersion
selection. The opaque authentication identity and its session/cookie/header and
CSRF context are trusted request-context inputs passed separately to the server
factory; they are never fields in, or derived from, the serialized request.
The JSON accepts no persistence receipt, authentication/session/CSRF value,
caller clock, URL, digest, authority, or runtime projection.

The browser supplies a cryptographically random 64-lowercase-hex request ID for
correlation only; it grants no authority. The host supplies an independent
64-lowercase-hex grant ID through a CSPRNG-backed port.

The trusted issuer invokes ADR-0039 issue and use, binds the resulting exact
asset selection, four committed row digests, and stable database-authoritative
review horizon, then signs a grant with a host-owned private-key port. Tenant,
actor, reviewer, session, request, server-generated grant identity, fixed HTTPS
audience, exact selection, commitments, issuance/expiry, and fixed unverified
evidence are
covered by the canonical signature. The serialized result is explicitly an
`Unverified` grant: its fixed evidence says verification is required and
`runtimeUsable:false`; it has no authority object or `qaPreviewRuntime:true`.
Grant lifetime is at most two minutes and defaults to 30 seconds; it is also
capped by authenticated-session,
committed-review capability, and review horizons.

The separate verifier has no signing dependency. It authenticates again,
requires an exact tenant-scoped public trust root and audience, verifies the raw
ES256 signature, enforces not-before/session/expiry/lifetime boundaries, and
atomically burns the grant in an online replay-store port. After burn and before
runtime invocation, it independently invokes ADR-0039 issue and use with the
same opaque identity and selection. The fresh asset selection, all four row
digests, and database review horizon must exactly match the signed grant, and
the fresh eligibility/session horizons must still contain the operation.
Reviewer revocation, GenerationJob head advance, source/MeasurementSet/variant
drift, review expiry, authentication drift, or database/replay-store outage
therefore denies the current attempt. Once `claim` has returned true, later
database, cancellation, or runtime failure leaves that grant burned. A rejected
replay-store call has an ambiguous outcome: this foundation does not claim that
its tombstone is durable or safely recoverable, and callers must not infer that
the grant is reusable.

Only after those checks may the verifier invoke a trusted server-side runtime
adapter with a deeply frozen command. The command's `qaPreviewRuntime:true`
authority is narrowly one operation; its generic runtime, public-live,
deployment, publication, and commerce authorities remain false. Adapter failure
or cancellation after claim leaves the grant burned.
The syntax parser is deliberately named `parseUnverified...`; parsing or cloning
a serialized grant cannot create a runtime command. No public syntax parser
returns an authority-shaped result.

An in-memory atomic replay store is executable deterministic evidence for one
process only. It is not production online replay authority.
JSC-0221B must add a durable PostgreSQL store and real-database acceptance for
ambiguous claim acknowledgement, tombstone readback/recovery, concurrent
consumption, timeout, connection loss, restart, and exact expiry.

The JSC-0221A bounded container is a separate, still-unverified common/server
boundary. Its binary profile is exactly the eight ASCII bytes `JQAPB001`, three
big-endian unsigned 32-bit lengths, and canonical envelope JSON, exact manifest
bytes, and GLB sections with no trailing bytes. Envelope, manifest, and model limits
are respectively 64 KiB, 256 KiB, and 32 MiB. Parsers snapshot input bytes via
intrinsics before asynchronous hashing and reject hostile views, zero/overflow/
over-limit lengths, truncation, trailing data, non-canonical envelope JSON, or
artifact digest/length mismatch.

The envelope schema carries a canonical raw-ES256 signature field and a
dedicated bundle-signer identity independent from the transport issuer
identity. Its signature payload is defined to bind the already-verified
transport grant payload (without its transport signature), exact content
types, byte lengths, SHA-256 digests, and a URL-free runtime-asset projection.
This sub-slice validates only signature syntax, not cryptographic trust; actual
signing and verification belong to the later server/browser orchestration.
That projection is selection-bound and contains only approved non-fixture identity, quality,
generation method, sorted source hashes, attachment matrix, and quality
envelope fields needed by a future browser reconstruction. It contains no
manifest/model URL or path. Bundle evidence remains fixed to
`verification:required`, `artifactContainerOnly:true`,
`browserRuntimeUsable:false`, and `publicLiveUsable:false`; syntax parsing,
hashing, or GLB validation alone creates no browser authority.

The manifest profile requires `fixture:false`, source hashes exactly equal to
the signed projection, and the inert canonical relative model name
`./model.glb`; absolute/private URLs, credentials, query/fragment, traversal,
backslash, and other locators are rejected. Actual model bytes must match the
manifest length and digest. The GLB profile is version 2 with exactly one
embedded BIN buffer and rejects every `uri`, extension surface, unsupported
chunk, or over-complex JSON structure before established node, accessor,
triangle, metre, and bounds validation. The container code performs no logging
and neither transport grant nor envelope carries a private locator.

## Consequences

The repository has strict signed transport contracts, separated issuer and
verifier trust boundaries, consume-time committed-review revalidation, an
online replay-store interface, a process-local reference store, and a trusted
runtime-adapter seam. It also has a strict bounded bundle format/parser and
artifact validator whose results remain explicitly unverified. A browser cannot
mint a valid grant from the public key, and JSC-0218A receipts remain
inadmissible.

This foundation does not yet fetch private manifest/model bytes from the final
fresh committed-review database snapshot, sign/serve a production response,
register a browser object-identity proof, or connect the browser runtime. The
current eligibility/runtime command does not carry the full authoritative
artifact locators, expected digests, and URL-free projection from that same
fresh snapshot; a second database lookup would violate the consume-time drift
invariant and is not substituted. Production completion still requires that
single-snapshot projection, one authenticated host handler, a dedicated bundle
signer and pinned rotation policy, private bounded fetch, a dedicated browser
verifier/loader, a production atomic replay
store, production keys, TLS, credentials, CSP/origin controls, shutdown, and
operations evidence. The generic `qa-preview` catalog loader remains closed
before every fetch. No QA-preview availability, publication, G1/G2, or physical
evidence PASS is claimed.

The foundation also does not claim post-sign clock freshness when a signer is
slow, nor continuous deadline enforcement throughout a runtime adapter call.
The single-response bundle handler must recheck trusted time after signing (or
make signing the last bounded operation), and the later runtime layer must own
an aborting deadline through byte verification, proof consumption, and runtime
initialization.
