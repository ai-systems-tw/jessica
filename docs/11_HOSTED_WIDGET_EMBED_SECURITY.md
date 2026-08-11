# Hosted Widget v1 embed, CSP, and camera boundary

This is the integration contract for the local E1 security slice. It is a design and
test fixture, **not evidence that any production response currently sends these
headers**. Production values must be generated per authorized tenant/site and
verified from actual response headers and browser behavior.

## Exact origins and iframe

Example values used only in documentation:

- parent EC: `https://shop.example`
- widget: `https://widget.example`
- widget URL: `https://widget.example/embed/v1/widget.html`
- catalog/API: `https://api.example`
- immutable assets: `https://assets.example`

The parent adapter requires the widget origin to be exactly an HTTPS origin (no
path, credentials, query, fragment, or trailing slash) and the widget URL to remain
beneath the configured `/embed/v1` prefix with no credentials, query, or fragment.
Production must substitute exact owned origins; wildcards and suffix matching are
not valid.

The iframe settings are:

```html
<iframe
  src="https://widget.example/embed/v1/widget.html"
  sandbox="allow-scripts allow-same-origin"
  allow="camera https://widget.example"
></iframe>
```

`allow-scripts` is required for the runtime. `allow-same-origin` is required for the
widget's origin-bound storage, verified assets, WASM, and camera behavior. No forms,
popups, top navigation, downloads, presentation, microphone, geolocation, or other
capabilities are granted. The widget must remain cross-origin from the parent; do
not serve it from the EC origin. JavaScript uses only the exact configured origin as
`targetOrigin`, never `*`.

## Header ownership

The **parent EC owner** must permit the widget frame and delegate camera to its exact
origin. A candidate parent policy is:

```http
Content-Security-Policy: default-src 'self'; frame-src https://widget.example; connect-src 'self'; worker-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
Permissions-Policy: camera=(self "https://widget.example"), microphone=(), geolocation=()
```

The **widget delivery owner** must constrain its own resources and embedding
parents. A candidate widget policy is:

```http
Content-Security-Policy: default-src 'none'; frame-src 'none'; connect-src https://api.example https://assets.example; worker-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://shop.example
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

This covers `frame-src`, `connect-src`, `worker-src`, `script-src`, `style-src`, and
`img-src` explicitly. `blob:` under `img-src` is confined to widget-local preview;
blob/data never cross `postMessage`. Remove it if the reviewed runtime does not need
local blob previews. Do not add `data:`, wildcard hosts, `unsafe-inline`, or
`unsafe-eval`. The actual self-hosted Worker/WASM implementation may require a
separately tested CSP refinement; capture the real browser console/network evidence
before production.

Both layers are required: the parent `Permissions-Policy` owns delegation into the
cross-origin frame, the iframe `allow` narrows that delegation, and the widget
policy governs use inside the frame. None can manufacture a user camera grant;
`getUserMedia` remains user-agent/user controlled.

## Protocol and privacy

Use `ParentWidgetHost.initialize`, `open`, `changeSku`, and `close`; do not mutate the
iframe URL or reach into its DOM to change SKU. The reciprocal bridge validates the
exact parent origin/window. Request IDs are single-use within a session. Session and
tenant mismatches, stale replies, and lifecycle-invalid messages are rejected.

The v1 adapters enforce one shared local budget of exactly 256 combined unique sent
and received request IDs per session (`WIDGET_MAX_SESSION_MESSAGES`). A parent
command and widget command intake reserve capacity for both the command and its
correlated response before posting or invoking controller work. The ledgers never
evict an old ID while the session remains usable. At exhaustion, pending work is
cleared, the adapter enters terminal `closed`, reports one local `MESSAGE_LIMIT`
rejection, and sends no protocol error echo; later messages/events are transport-
inert. Malformed messages and wrong origin/source/tenant/session bindings are denied
before ledger admission and therefore do not consume this replay budget.

This is an in-browser per-session availability bound, not remote or production rate
limiting. Authenticated server/CDN rate limits, abuse controls, and observability
remain deferred with the production embed authorization work.

`cameraPermission` and `tryOnStarted` exist only to expose the minimum asynchronous
lifecycle needed by EC UX. They contain a closed permission state or SKU. Capture
events return a widget-local opaque handle. No camera frame, image, landmark,
transform, pose, scale, raw analytics, blob, bytes, or data URL may cross the frame.

## Camera-free fixture and deferred work

`fixtures/widget/camera-free-protocol-flow.json` is a deterministic message-only
fixture. It requests no camera and proves no browser permission or production embed
behavior. Before a live integration, add signed embed token/API-key/authentication
design, server-side tenant/site/origin authorization, expiry/revocation, rate limits,
an analytics backend restricted to the same non-biometric schema, real EC cart
handling, production headers, and live cross-browser camera/permission evidence.
