# Guarded Writes And Human Approval

Write-capable agents need friction by design.

## Default Contract

Every mutation accepts:

```json
{
  "mode": "preview",
  "idempotencyKey": "unique-change-key",
  "changeReason": "Why this change is needed"
}
```

## Preview Mode

Preview mode should return:

- intended API call;
- target object;
- expected field changes;
- missing prerequisites;
- risk notes;
- rollback hint.

Preview mode must not modify production data.

## Apply Mode

Apply mode should require:

- explicit `mode: "apply"`;
- idempotency key;
- change reason;
- model-specific validation;
- audit output.

## Idempotency

Idempotency prevents accidental duplicates when an operation is retried.

For create operations, prefer a durable marker:

- metadata in description;
- a unique prefix;
- a tag/label;
- a lookup before create.

In-memory or local file idempotency is useful for pilots, but it is not enough for critical production workflows.

## Production Pilot Rule

Use visible markers:

```text
MCPTEST:: Example Name
mcp-pilot
do-not-report
```

This makes test data searchable, reversible, and explainable.
