# ADR-0002: Keep face processing browser-local by default

Status: Accepted

Camera frames and landmarks stay in the browser unless a future explicit user-consented feature requires otherwise.

Consequences:

- lower privacy and storage risk;
- no server-side video processing bill;
- mobile performance becomes a primary constraint;
- analytics must exclude biometric payloads.
