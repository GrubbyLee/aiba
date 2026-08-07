# Portability

AIBA contracts describe behavior and trust boundaries, not frameworks or UI.
The executable fixtures prove that the same model can be adapted without a
shared application stack.

| Surface | Boundary under test | Fixture |
| --- | --- | --- |
| TypeScript service | Injected storage and provider adapters | `fixtures/identity-reference` |
| HTTP API | Trusted session context and strict request bodies | `fixtures/review-access-wechat-native/src/server` |
| Native Mini Program | One-time login exchange and application session | `fixtures/review-access-wechat-native/miniprogram` |

Business resources remain project-owned. Portable interfaces use generic
resource identifiers, trusted principal context, bounded queries, optimistic
revisions, idempotency, and evidence requirements rather than built-in domain
entities.
