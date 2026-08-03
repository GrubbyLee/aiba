# File Assets Capability

`file-assets` manages untrusted uploaded content through an authorized,
tenant-scoped lifecycle. It verifies bytes rather than client metadata,
quarantines content before availability, uses server-generated storage keys,
keeps assets private by default, and makes deletion terminal.

The contract does not prescribe an object-storage provider, upload widget,
database, framework, or public URL format. Provider-specific direct-upload and
malware-scanning adapters remain implementation choices that must preserve the
same invariants.
