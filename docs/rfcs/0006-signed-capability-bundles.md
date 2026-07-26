# RFC 0006: Signed Capability Bundles

Status: Accepted for M4.1 implementation

## Purpose

Let AIBA distribute capability packs through public or private registries while
preserving publisher identity, file integrity, and the rule that packs are
untrusted data rather than executable plugins.

## Bundle Layout

```text
<bundle>/
  bundle.json
  bundle.sig.json
  pack/
    capability.yaml
    README.md
    recipes/*.yaml
    migrations/*.yaml
```

`bundle.json` lists every pack file with its relative path, byte size, and
SHA-256 digest. Paths are sorted and unique. Symlinks, devices, sockets,
scripts, binaries, and undeclared files are rejected. The initial format only
permits the capability manifest, documentation, recipes, and migrations.

## Signature

Publishers sign the RFC 8785 canonical JSON representation of `bundle.json`
with Ed25519. `bundle.sig.json` records the key ID, manifest digest, algorithm,
and base64url signature. Whitespace changes to the JSON transport do not alter
the signed semantics.

Private keys are never stored in a bundle or trust policy. Key generation writes
PKCS#8 private keys with owner-only permissions. Verification accepts only
Ed25519 SPKI public keys.

## Trust Policy

A local trust policy maps a publisher ID and key ID to a public key and an exact
capability allowlist. A cryptographically valid signature from an unknown key,
or a trusted key signing an unapproved capability, is rejected. Key rotation is
represented by adding a new key entry rather than silently replacing key
material under an existing ID.

## Verification

Core verifies, in order:

1. Bundle, signature, and trust-policy schemas.
2. Publisher/key/capability authorization.
3. Manifest digest and Ed25519 signature.
4. Exact file set, byte sizes, and SHA-256 hashes.
5. Capability identity/version plus every recipe and migration schema.
6. Recipe semantics against the bundled capability contract.

No bundle file is imported, executed, or passed to a shell. A verified bundle
is trusted as publisher-authenticated data, not as safe executable code.

## Registry Boundary

Registries index and transport these bundles. Registry authentication,
commercial access control, caching, and governance cannot weaken local bundle
verification. Signed registry indexes and anti-rollback state are separate M4.2
protocol work.
