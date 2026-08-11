# Candidate capture intake

This boundary accepts a non-J1 candidate without pretending that one annotated image is a complete G1 capture.

1. Keep raw images outside Git, preferably under the local directory named by `JESSICA_PRIVATE_SOURCE_ROOT`.
2. Copy `candidate.template.json` to a protected working location and replace `relativePath`. It resolves under `JESSICA_PRIVATE_SOURCE_ROOT` when configured, otherwise beside the specification file.
3. Run `npm run frame:source:inspect -- <candidate.json>` to derive the real SHA-256, byte length, MIME type, pixel dimensions, immutable private object key, and file timestamp.
4. Copy `capture-draft.template.json` to the protected working directory. Replace its source placeholder with the inspected `SourceAsset`.
5. Transcribe each visible dimension into `measurementSet.measurements` and add one evidence record per field. An image-derived record stays `verification: "unverified"` until a caliper measurement verifies it.
6. Run `npm run frame:capture:check -- <capture-draft.json>`.

Raw product images must not be committed or distributed from a public runtime path. Do not duplicate one overview image under front, side, or marking roles to simulate six-view coverage. A single annotated overview can make a source and measurement draft valid, but it cannot make G1 ready, generate trustworthy side geometry, or replace an actual-wear fixture.

The committed templates intentionally fail closed. Keep completed working manifests private unless their source rights and publication scope have been reviewed.
