# Users Capability

`users` defines tenant-scoped user lifecycle management over trusted identity,
authorization, and audit boundaries. It separates profile data from roles and
credentials, uses explicit states, and coordinates disable/delete with session
revocation.

It does not prescribe a user table, directory provider, permission model, or UI.
