# ADR 0008: Signed active Deployment proof for public-live

## Status

Accepted — JSC-0210 tooling/integrity boundary. No production activation evidence is asserted.

## Context

A catalog entry being `published` and `recommendedForLive` proves asset eligibility, not control-plane authorization. Accepting catalog, SKU, hash, or public key from one query string would let the requester self-assert the trust chain. A TypeScript `DeploymentPointer` is structural and is not a security capability.

## Decision

`public-live` has one exported application entry point. The generic catalog loader rejects it unconditionally. The application entry point fetches one no-store signed envelope from a host-allowlisted HTTPS deployment origin, caps envelope/payload size, selects a host-pinned `keyId → authorityId + public P-256 JWK`, verifies ES256 over the exact base64 payload bytes, checks the payload SHA-256, and only then parses Deployment JSON. Signature mechanics stay in the application adapter; versioned Deployment payload types and the pure evaluator remain inward.

Host configuration, not the query, fixes tenant/site/environment, deployment and catalog origin allowlists, key map, minimum revision/generation, and maximum signed document age/lifetime. The query may select only a deployment envelope URL within that boundary. A document has exactly one active pointer per tenant/site/environment stream and binds SKU, frame model, variant, immutable asset id/version, catalog URL and actual-byte hash, manifest/model hashes, activation/audit provenance, allowed origin, revision/generation, and rollback-safe prior pointer.

Catalog bytes are fetched once, hashed, then parsed. Manifest and GLB bytes remain single-fetch verified, and the exact verified GLB ArrayBuffer reaches GLTFLoader. Host catalog origins intersect the signed `allowedOrigin`; catalog, manifest, model, and redirects must remain on that HTTPS origin. `qa-preview` and `calibration` keep their explicit non-deployment paths.

The browser stores one receipt per JSON-encoded `[tenantId, siteId, environment]`. Web Locks serialize a re-read compare-and-set. The same revision+generation is idempotent only for the same deployment digest; otherwise both counters must strictly increase and the prior pointer must match the entire previous receipt, including deployment SHA-256. Rolling back an asset therefore requires a new Deployment revision.

## Security boundary and limitation

The local receipt prevents rollback/replay relative to history already observed by that browser and Web Locks close same-origin cross-tab races. It is not an external deployment authority. Storage clearing or a new browser removes local history; those clients are bounded only by immutable host floors, signed expiry, and host maximum age/lifetime. Absolute replay prevention requires an online freshness authority or server-side monotonic CAS and is not claimed here.

The public-live browser minimum for this local authority path is Safari 15.4, where Web Locks are available; the required P-256 ECDSA/JWK WebCrypto operations predate that boundary. Safari Lockdown Mode disables Web Locks, so `navigator.locks` absence is an explicit fail-closed unsupported/alternate-authority case. There is no silent non-locking fallback.

The committed P-256 fixture identity is explicitly test-only/non-production. No production key, signature, deployment event, or activation evidence is included.

## Consequences

Product/SKU changes are Deployment/catalog data changes and require no TypeScript or HTML edits after host trust configuration. Key rotation/revocation is represented by the host key map. Production origins require HTTPS. Public-live fails before catalog/backend/WebGL access when deployment proof or monotonic storage is unavailable.
