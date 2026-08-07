# inbox - In-Application Message Center

Provides a headless, principal-scoped inbox for application messages. It owns
message read state and listing behavior; `notification` owns delivery to in-app,
email, SMS, and provider channels.

## What it provides

- Trusted event and server-template message creation.
- Bounded filtering with opaque, scope-bound cursors.
- Unread, read, and archived states with optimistic revisions.
- Atomic batch transitions and exact idempotency replay.
- Minimized public records without recipient or provider details.

## What it does not provide

- A framework-specific notification bell or message-center UI.
- Arbitrary user-authored broadcast content.
- Email, SMS, or WeChat delivery; compose `notification` when needed.

```bash
aiba add inbox
aiba verify
```

See [SECURITY_TESTS.md](SECURITY_TESTS.md) for the adversarial checks.
