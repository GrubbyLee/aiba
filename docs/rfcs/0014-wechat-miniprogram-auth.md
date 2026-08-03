# RFC 0014: WeChat Mini Program Authentication Boundary

Status: Accepted

## Context

Mini Programs need provider login, but directly embedding WeChat behavior in
identity would make AIBA provider-specific and encourage clients to handle
AppSecret, OpenID, or `session_key`. The integration must preserve the generic
identity principal while respecting WeChat's one-time server exchange.

## Decision

`wechat-miniprogram-auth` is a `platform-integration` capability depending on
`identity` and `audit`. Its command carries only a bounded one-time code. The
application server exchanges that code through a fixed HTTPS provider adapter,
consumes a SHA-256 replay key, validates provider identity, and passes provider
fields only to a trusted identity binder. Its portable result carries only an
AIBA principal and issuance timestamp.

Provider credentials and endpoint configuration are server-owned. Provider
errors fail closed. `session_key`, AppSecret, raw or hashed code, OpenID, and
UnionID are excluded from client results and audit. The identity binder must
return a user principal in the trusted tenant and commit binding with required
success audit as one reliability boundary.

## Consequences

Native clients can use `wx.login` without learning account-binding details.
CloudBase, custom servers, and future provider adapters can implement the same
contract. This capability does not define application session token format,
account-linking UI, or authorization policy.
