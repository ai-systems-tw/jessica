# Ground Truth evidence boundary

`canonical.template.json` is an intentionally incomplete authoring template. It is not a fixture, proof, sample PASS, or promotion artifact. The CI template check succeeds only when the canonical evaluator rejects it.

Raw actual-wear images and video must not be committed. Consented media remains in the approved external evidence store; the evidence document contains pseudonymous identifiers, retention scope, actual SHA-256 digests, and capture/render/trace provenance only.

Run `npm run quality:evidence -- path/to/evidence.json`. Exit `0` means the selected gate is ready, `1` means structurally valid evidence is incomplete or failed, and `2` means malformed or contract-invalid input. JSON issues and coverage are emitted to stdout in every case.
