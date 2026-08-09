# J1-M external input boundary

These templates intentionally fail readiness checks until real J1-M data is supplied.

1. Copy `intake.template.json` to an ignored or appropriately protected working file.
2. Enter caliper/marking measurements, source-photo paths, and SHA-256 hashes.
3. Author the normalized GLB in metres and record its immutable URLs and attachment matrix.
4. Run `npm run j1m:check -- <intake.json>`.
5. Capture an actual-wear image with consent, annotate the actual and rendered points in `placement.template.json`, and run `npm run quality:placement -- <annotation.json>`.

Do not replace zero/`REQUIRED` placeholders with estimates merely to make the check pass.
