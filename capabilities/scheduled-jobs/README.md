# Scheduled Jobs Capability

`scheduled-jobs` defines framework-neutral deferred execution. Applications
expose stable definition identifiers; handlers, credentials, tenant scope,
retry limits, and lease duration remain trusted server configuration.

Adapters must authorize scheduling, bind idempotency keys to exact commands,
atomically lease due jobs, cap retries, reject terminal replay, and expose only
minimized records. Capability packs never provide or execute job code.
