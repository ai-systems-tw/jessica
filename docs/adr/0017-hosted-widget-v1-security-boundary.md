# ADR-0017: Hosted WidgetProtocol v1 security boundary

- Status: Accepted
- Date: 2026-08-11
- Ticket: Jessica Completion Loop 17 / E1 Hosted Widget

## Context

ADR-0003 selects a cross-origin hosted iframe, and ADR-0002 keeps camera frames,
images, face landmarks, and derived geometry in the browser. The former protocol
sketch named events but did not define exact payloads, correlation, parsing limits,
or lifecycle authority. A permissive `postMessage` boundary would make the privacy
rule unenforceable.

## Decision

`packages/contracts/src/widgetProtocol.ts` is the public, versioned v1 contract.
Every message has an exact protocol/version/direction, bounded tenant/session/request
identity, explicit nullable reply correlation, a closed type, and an exact payload.
Unknown versions, types, directions, fields, prototypes, symbols, accessors, cycles,
non-finite numbers, excessive depth/node/string size, invalid correlation, and
replayed identifiers fail closed.

The public unknown-input boundary also exports non-throwing safe parse results with
stable generic rejection codes/messages. Adapters use this boundary, so hostile
getters, cycles, custom prototypes, and malformed fields cannot escape as exceptions
or disclose raw field/path details.

Parent commands are `init`, `open`, `close`, and `skuChange`. Widget events are
`ready`, `opened`, `assetChanged`, `captureCreated`, `cartRequested`, `closed`, and
`error`. `cameraPermission` and `tryOnStarted` are the only additional v1 lifecycle
events. They are necessary to distinguish the asynchronous camera-permission result
from successful runtime start without exposing camera or tracking data. Both are
closed enums/identifiers, spontaneous only, and accepted only while open.

All biometric, face, video, image, photo, landmark, transform, pose, scale, pixel,
raw analytics/telemetry, blob, byte, base64/data-URL, stack/path, and secret/API-key
payload field aliases are denied recursively before dispatch. Schema closure is the
primary control and the alias denylist is defense in depth. A capture event carries
only a bounded `local-capture:` opaque reference meaningful inside the local widget
session; bytes, blobs, URLs, and data URLs never cross. Public errors use a closed
code-to-class mapping, bounded safe text, and no path, stack, URL, token, key, or
secret.

The parent adapter pins an exact HTTPS widget origin and a URL contained beneath an
explicit path prefix. It uses that origin as `targetOrigin`, validates exact
`event.origin`, `event.source`, tenant, session, request, reply, and lifecycle state,
and rejects replay/stale messages. It configures only `allow-scripts
allow-same-origin` and an origin-scoped camera allow. The reciprocal widget bridge
performs the same checks against the exact parent window/origin. SKU changes occur
only through the protocol. Both implementations depend on testable ports rather
than direct DOM globals.

Every otherwise valid and correctly bound inbound request ID is reserved before
reply/lifecycle dispatch. A stale or correlation-invalid message therefore remains
spent and cannot become acceptable after a later state transition. The widget
reserves a command ID before controller work, preventing its response ID from
colliding with the command. Controller work is at-most-once even when response
transport fails; the bridge closes locally, emits one deterministic transport-failure
signal, and does not recursively send on the broken port.

Both adapters share an exact 256-message session ceiling across unique inbound and
outbound request IDs (`WIDGET_MAX_SESSION_MESSAGES`). Replay IDs are never evicted
from a usable session. Command paths reserve capacity for the command and its
correlated response before transport or controller effects. When the ceiling cannot
accommodate the required IDs, pending work is cleared, local state becomes terminal
closed, and one stable `MESSAGE_LIMIT` observer rejection is raised without sending
a protocol error/close echo. Further transport is inert. Malformed input and wrong
origin/source/tenant/session bindings are rejected before ledger admission and do
not consume the replay ledger.

This local memory bound does not claim remote rate limiting. Production edge/API
rate limits, authenticated abuse controls, and monitoring remain deferred.

Parent pending entries bind their exact pre-command stable state, candidate SKU, and
close reason. A correlated recoverable error rolls init back to created (clearing
SKU), open to ready, SKU change to unchanged open, and close to its exact ready/open
state. A non-recoverable error closes. Recoverable spontaneous errors are accepted
only in ready/open and never mutate state; transitional spontaneous errors are stale
and their IDs remain spent. A correlated closed event must echo the exact close
reason.

Page hide and host destruction are terminal even while init/open replies are in
flight. The parent clears pending correlations, enters `closed`/`destroyed`, and
best-effort posts an exact close command to the already bound iframe without waiting
for its reply. Queued ready/opened callbacks cannot leave the terminal state, and a
queued callback captured before listener removal is inert after destruction. Public
widget events cannot post after closed/destroyed except the close event emitted as
part of the transition itself.

Parent observers are untrusted ports: exceptions from `onEvent`/`onReject` are
contained after transport state is committed. Listener registration is transactional;
if page-hide registration fails after message registration, both registrations are
best-effort removed before the setup failure is returned. Iframe setter failures
occur before listener registration.

## Consequences and residuals

This is a locally tested protocol/security slice, not a deployed Hosted Widget.
No production CSP, Permissions-Policy, camera grant, embed authorization, analytics
backend, EC integration, or remote service exists. API-key design, signed embed
token issuance/verification/expiry/revocation, tenant/site authorization, and a
production analytics sink remain required before live use. A token or credential
must not be added to v1 payloads or errors; its transport requires a separately
reviewed authenticated embed design.

The camera permission and cross-origin iframe behavior still require live browser/
EC validation. This ADR creates no physical evidence, publication, deployment, or
quality-gate promotion.
