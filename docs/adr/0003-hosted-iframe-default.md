# ADR-0003: Hosted iframe is the default external embed

Status: Accepted

External shops receive a loader and hosted iframe. Direct Web Component integration may be offered later.

Consequences:

- controlled runtime versions;
- clearer CSP/camera documentation;
- postMessage protocol becomes a public contract;
- parent origin validation is mandatory.
