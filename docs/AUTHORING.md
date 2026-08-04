# Capability Authoring

AIBA authoring tools create semantic contracts, not application framework code:

```bash
aiba create capability appointment-booking --out ./capabilities
aiba lint ./capabilities/appointment-booking
aiba test-pack ./capabilities/appointment-booking
```

The scaffold contains a capability manifest, one bounded recipe, a README, and
a security test plan. Replace the generic invariant with precise, observable
rules before distribution. Every invariant must be covered by an operation and
have test evidence guidance. At least one invariant must be critical.

`test-pack` is a static readiness gate. It never executes the pack or claims
that tests passed. Runtime behavior requires project conformance tests and, when
needed, the trusted proof workflow from RFC 0017.

Create an exact Solution only from existing validated packs in dependency order:

```bash
aiba create solution appointment-management \
  --capability audit identity authorization appointment-booking \
  --packs-dir ./capabilities --out ./solutions
aiba lint ./solutions/appointment-management --packs-dir ./capabilities
```

Core computes exact versions and Manifest hashes. It rejects missing
dependencies, incorrect order, duplicate IDs, overwrites, scripts, executable
content, symbolic links, special files, malformed schemas, and recipe scope
violations. Signing and distribution are separate release steps.
