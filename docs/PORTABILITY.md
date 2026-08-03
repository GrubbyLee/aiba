# Capability Portability

M7 validates that stable capability semantics can survive materially different
application surfaces without imposing one UI framework or transport.

## Vehicle Records

| Surface | Adapter | Contract evidence |
| --- | --- | --- |
| TypeScript HTTP API | Trusted session context, bounded list query, exact PATCH body | `src/vehicle-records-http.test.ts` |
| Web admin | Same-origin cookie transport and operational vehicle table | `src/vehicle-web-admin.contract.test.ts` |
| Native Mini Program | Application session header and `wx.request` vehicle list | `src/vehicleClient.contract.test.ts` |

All three use the same `VehicleRecord`, list limit, opaque vehicle ID, revision,
status, and mileage semantics. Neither client sends tenant, role, permission, or
provider identity claims. The API derives `Principal` and tenant from trusted
session state before calling the verified `vehicle-records` service.

## WeChat Platform Boundary

`wechat-miniprogram-auth` adds the provider-specific edge without changing the
identity contract. Native code sends only the one-time `wx.login` code. The
server owns AppID, AppSecret, endpoint, provider response validation, replay
state, OpenID/UnionID binding, and audit. The portable result excludes
`session_key`; an application session token may be transported separately.

These fixtures are conformance surfaces, not a shared application template.
Projects remain free to replace HTTP libraries, UI systems, storage, session
format, and deployment provider while retaining the same contracts and tests.
