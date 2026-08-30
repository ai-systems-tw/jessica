# ADR-0040: Authenticated one-shot QA-preview transport foundation

## Status

Accepted for the JSC-0221 server foundation, bounded bundle container, and
JSC-0221A2 authenticated bundle-to-runtime library boundary. Durable production
replay, production host authentication/key/deployment wiring, and an installed
QA-preview UI remain open.

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

JSC-0221A2 preserves one browser POST. Its exact JSON is still only
`{requestId, selection}`; authentication, session, cookie/header, and CSRF state
remain an opaque trusted-host argument. The host performs exactly one internal
grant issue and one consume and does not retry a burned or outcome-ambiguous
grant. A host-owned maximum operation timer and abort controller race the whole
issue/consume chain, so an authentication, core, replay, signer, or adapter port
that ignores cancellation cannot retain the response indefinitely; late results
are discarded. The browser never receives or needs the full transport grant.

The final ADR-0039 capability consumption now has a separate server-only result
that pairs unchanged public diagnostic eligibility with the private runtime
binding reconstructed by that same final authoritative database snapshot. It
contains the exact private locators, expected artifact hashes and lengths, and
the URL-free projection inputs. The transport creates a deeply frozen runtime
command from the full verified grant and this binding and registers the exact
command in a module-private identity store. The bundle adapter atomically claims
that object once; a structural clone or caller-authored `qaPreviewRuntime:true`
object cannot access private source or signing authority. A second adapter-side
database lookup is forbidden.

Private artifact reads select exactly one member of a non-overlapping canonical
HTTPS directory-prefix set, reject credentials, query/fragment, encoded traversal,
redirects, non-200 responses, wrong response URL, content type or encoding, and
missing/mismatched declared or actual lengths. The adapter snapshots all bytes,
rechecks database-bound hashes, selection, source list, and the inert
`./model.glb` manifest relation, then applies the self-contained GLB validator.
Private locators are not copied into envelope fields, browser assets, or error
results.

A dedicated ES256 bundle signer must use a different authority and different
P-256 key material from every transport key accepted by the paired verifier.
The adapter requires a non-empty exact transport-key exclusion set, verifies the
signer's output with its declared canonical public JWK, and rejects coordinate
aliasing even when authority/key labels differ. The canonical envelope payload
adds `composedAt` and `transportGrantSha256`, the SHA-256 of the canonical full
internal grant including its transport signature. The latter proves the server
verifier-to-composer audit binding; because this is one browser POST, it is not
evidence that the browser possessed or independently recomputed the full grant.
The composer checks trusted time before signing and again after bundle
composition against transport, eligibility, committed-review, and cancellation
horizons.

The HTTP-neutral host response is exactly status 200 with
`application/vnd.jessica.qa-preview-runtime-bundle.v1`, exact `Content-Length`,
`X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`,
`Referrer-Policy: no-referrer`, `Content-Disposition: inline`, and
`Cross-Origin-Resource-Policy: same-origin`. The dedicated browser loader uses a
CSPRNG request ID, same-origin credentials, explicit CSRF header, redirect error,
no-store, and no-referrer. It bounds the response before parsing, validates the
canonical envelope and pinned tenant/key validity, audience, request, selection,
and time binding, and verifies the bundle ES256 signature before manifest or GLB
traversal.

Only after every artifact check does the loader retain a private owned model-byte
copy and register an identity-only handle in a module-private `WeakMap`. Handle
consumption deletes that exact identity synchronously before runtime construction
or any await. Clones and replays fail. One absolute deadline covers the request,
response read, signature and artifact verification, handle consumption, runtime
initialization, and disposal on expiry or cancellation. Serialized bundle
evidence remains `browserRuntimeUsable:false`; browser authority exists only in
the private registration, never in a parsed plain object.

## Consequences

The repository now has strict signed transport contracts, separated issuer and
verifier trust boundaries, consume-time committed-review revalidation, an online
replay-store interface, same-final-snapshot private artifact binding, strict
private fetch, a dedicated response signer, one-POST host response, pinned
signature-before-GLB browser verification, and one-shot deadline-bound runtime
admission. Wire parsers and serialized evidence remain explicitly
non-authoritative. A browser cannot mint a valid grant, bundle, command, or
handle from public keys or structural clones, and JSC-0218A receipts remain
inadmissible.

This is executable library evidence, not production deployment. The replay store
is still process-local; JSC-0221B must provide append-only PostgreSQL CAS,
tombstone readback and ambiguous-outcome recovery, a dedicated migration/role/
provider, and real PostgreSQL race, reconnect, timeout, restart, and expiry
acceptance. Production authentication, CSRF validation, TLS, credentials,
signing-key provisioning and rotation, endpoint installation, CSP/origin policy,
shutdown, monitoring, remote rows, and operations evidence also remain open.

The generic `qa-preview` catalog loader remains closed before every fetch.
Public-live proof and `main.ts` are unchanged, and no deployed QA-preview camera
or UI availability is claimed. Nothing in JSC-0221A2 creates publication,
commerce, physical, same-specimen, marking, caliper, actual-wear, J1-M, or G1-G7
evidence.
