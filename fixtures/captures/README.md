# Candidate capture intake

This boundary accepts a non-J1 candidate without pretending that one annotated image is a complete G1 capture.

1. Keep raw images outside Git, preferably under the local directory named by `JESSICA_PRIVATE_SOURCE_ROOT`.
2. Copy `capture-author.template.json` to a protected working location. Set the source `relativePath`, which resolves under `JESSICA_PRIVATE_SOURCE_ROOT` when configured and otherwise beside the authoring file.
3. Transcribe exactly the five visible required dimensions. Each author record accepts only `field`, `sourceId`, `valueMm`, `rawLabel`, and an optional `regionPx`; it cannot supply a hash, object key, method, verification, or verifier.
4. Run `npm run frame:capture:author -- <capture-author.json>`. The command inspects actual bytes, binds their SHA-256 and immutable object key, assembles the draft, validates it, and exits 0 when the candidate draft is valid.
5. Preserve the returned `g1Ready: false` and `g1Issues`. Image-transcribed evidence is always emitted as `method: "annotated-image"` and `verification: "unverified"`; only a separate trusted verification workflow may promote it.

The lower-level `frame:source:inspect` and `frame:capture:check` commands and their legacy templates remain useful for diagnosis. The author command is the safe normal path because authors never copy provenance or verification claims into a draft. Its canonical draft omits filesystem timestamps, so identical input and bytes produce identical draft JSON.

Raw product images must not be committed or distributed from a public runtime path. Do not duplicate one overview image under front, side, or marking roles to simulate six-view coverage. A single annotated overview can make a source and measurement draft valid, but it cannot make G1 ready, generate trustworthy side geometry, or replace an actual-wear fixture.

The committed templates intentionally fail closed. In particular, their zero values and `REQUIRED` path are not evidence. Keep completed working manifests private unless their source rights and publication scope have been reviewed. The user's described non-J1-M image is not currently present in this repository, so no real candidate intake has been claimed.
