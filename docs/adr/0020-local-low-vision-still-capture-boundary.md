# ADR-0020: Local low-vision still capture boundary

## Status

Accepted for local preparation.

## Context

Jessica does not sell prescription eyewear, but a user may need to remove prescription glasses
to try on fashion frames and then be unable to read ordinary controls. E4 calls for large controls,
a countdown, an optional audio cue, and review after the user puts their glasses back on. This must
not weaken the browser-local face/media boundary, E1's bounded local capture reference, or E3's
occurrence-only analytics boundary.

## Decision

Use a DOM-free deterministic state machine behind injected timer, optional audio, and AbortSignal
capture ports. Countdown transitions are exactly 3→2→1 in 1,000 ms steps. Every callback is
generation-bound and one-shot; cancellation, camera loss, page hide, close, destroy, reentrancy,
duplicates, and late completion fail closed. Capture results are hostile unknown input and must be
exact plain objects containing a bounded `local-capture:` reference and a receiver-preserving local
review capability.

The browser adapter composites only bounded camera/overlay dimensions and retains the encoded still
behind a revocable Blob object URL. The reference is generated before allocating the URL. Every exit
from review disposes it. No still bytes or URLs are stored or transmitted.

Public state serialization is an exact closed projection of phase, countdown, audio state,
reduced-motion preference, and stable failure code. It rejects accessors, symbols, custom prototypes,
unknown fields, and structurally impossible phase combinations before dereference. E1 and E3 are
separate exception-contained observers: E1 may receive the bounded local reference; E3 receives an
argument-free occurrence and can never receive that reference.

The UI uses native buttons, large targets, visible focus, labelled live status/timer and modal review,
inert background, focus entry/restoration, Escape terminal close, text in addition to color, reduced
motion, forced colors, and an explicitly user-controlled default-off audio cue. Audio failure is
non-fatal because browser autoplay permission is not assumed.

## Consequences

Deterministic tests can prove local transition, privacy projection, port, and static semantic behavior.
They cannot prove actual camera composition, browser/assistive-technology interoperability, usability
for low-vision users, WCAG conformance, accessibility certification, production consent/telemetry, or
device performance. Existing-glasses overlay remains research-only. G1, G2, G3, and G4 are unchanged.
