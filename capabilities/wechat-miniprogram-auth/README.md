# WeChat Mini Program Authentication Capability

This platform integration maps a WeChat Mini Program one-time login code to an
AIBA principal through a server-owned provider and identity boundary. It does
not prescribe CloudBase, a web framework, session format, account-linking UI,
or database.

AppSecret and `session_key` remain outside all portable interfaces. Provider
errors, replay, client-selected identity fields, and unbounded transport fail
closed.
