# Review Access

This capability defines generic reviewer access. Platform adapters may bind it
to a WeChat Mini Program release, an App Store review account, a demo tenant, or
another external review workflow.

The capability does not prescribe routes, tables, authentication libraries, or
UI. A valid implementation must satisfy every invariant in `capability.yaml`.

M0 verifies receipt coverage and evidence integrity. M1 will add executable
black-box conformance tests and the first WeChat adapter.
