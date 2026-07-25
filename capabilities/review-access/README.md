# Review Access

This capability defines generic reviewer access. Platform adapters may bind it
to a WeChat Mini Program release, an App Store review account, a demo tenant, or
another external review workflow.

The capability does not prescribe routes, tables, authentication libraries, or
UI. A valid implementation must satisfy every invariant in `capability.yaml`.

M0 verifies receipt coverage and evidence integrity. The `typescript-reference`
recipe adds non-executable semantic operations, bounded write paths, and
evidence suggestions for Agent-assisted installation. The `wechat-native`
recipe and fixture exercise the same contract through a native Mini Program,
server-authoritative TypeScript boundary, and black-box HTTP attack tests.
