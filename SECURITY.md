# Security

## Secrets

Never commit API tokens, OAuth tokens, cloud IDs tied to private deployments, `.env` files, generated MCP config files, or tenant-specific schema files.

This repo intentionally ignores:

- `.env`
- `.env.local`
- `.mcp.json`
- `config/tenant-model.local.json`
- generated deployment config

Use `config/tenant-model.example.json` only as a shape reference.

## Write Access

The MCP servers support write operations, but production use should follow these rules:

- keep `mode: "preview"` as the default;
- require explicit `mode: "apply"` for mutations;
- require `idempotencyKey` and `changeReason` for apply calls;
- use visible test prefixes such as `MCPTEST::` for pilots;
- restrict production apply operations through allowlists where possible;
- review audit output before accepting a change.

## Reporting Issues

If you find a security problem, do not open a public issue with secrets, tenant identifiers, internal URLs, or production payloads. Open a minimal report without sensitive data.
