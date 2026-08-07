# form-engine - Dynamic Form Engine

Schema-defined dynamic forms with server-side validation, field dependency
rules, and submission receipts.

## What it provides

- Portable form definitions with typed string, number, boolean, date, select,
  multiselect, textarea, and file fields.
- Server-side validation against the declared schema for every submission.
- Conditional field visibility rules driven by other field values.
- Per-form revisions so each submission records exactly which version
  validated it.
- Structured submission receipts with validation errors and computed
  values.

## What it does not provide

- UI rendering components for any specific framework.
- Drag-and-drop form builder UI.
- Form submission storage backend - you connect your own data source.
- Workflow approval on submission (use `workflow-approval` for that).

## Interfaces

- `form-engine.schema-command` / `form-engine.schema-result` - fetch a
  form schema by form code and revision.
- `form-engine.submit-command` / `form-engine.submit-result` - submit
  form data and receive a validated receipt with errors or confirmation.

## Quick start

```bash
aiba add form-engine
aiba verify
```

See [SECURITY_TESTS.md](SECURITY_TESTS.md) for attack surface coverage.
