# Jira Premium Capabilities

This playbook explains how to use PM Unleashed with Jira Product Discovery Premium and Jira Software Premium.

Premium does not replace the core operating model:

```text
Organization Goal -> Business Goal -> Atlassian Project -> JPD Idea -> Jira Epic
```

It adds richer discovery and portfolio planning layers around that model.

## What Premium Adds

- Jira Product Discovery Premium can expose multiple JPD issue types, hierarchy-like relationships, and connection fields.
- Jira Software Premium can expose Jira Plans / Advanced Roadmaps concepts such as parent links, teams, target dates, dependencies, and cross-project planning.
- These capabilities are tenant-configured, so agents must discover fields and permissions before writing.

## Recommended Flow

1. Run `health_check`.
2. Run `discover_jira_schema`.
3. Run `discover_premium_capabilities`.
4. Use `list_jpd_issue_types` to inspect JPD issue types per space.
5. Use `discover_jpd_connections` before attempting any JPD connection write.
6. Use `plans_health_check` before calling plan tools.
7. Use `search_portfolio_items` to inspect Advanced Roadmaps fields before setting them.
8. Use `mode="preview"` before every write.

## Tool Groups

### JPD Premium

- `list_jpd_issue_types` lists all issue types in JPD spaces.
- `search_jpd_items` searches across JPD issue types, not only `Idea`.
- `get_jpd_item` reads one JPD work item with known portfolio fields.
- `discover_jpd_connections` lists connection-like JPD fields visible through schema discovery.
- `set_jpd_connection` validates issue `editmeta` before writing a connection field.

### Jira Plans

- `plans_health_check` reports whether the current token can access the Jira Plans API.
- `list_plans` and `get_plan` read Jira Plans when the API is available.
- `create_plan` and `update_plan` are guarded writes and usually require `Administer Jira`.

If the Plans API returns `403`, treat it as a permissions limitation, not as a broken MCP.

### Advanced Roadmaps Fields

- `search_portfolio_items` searches Jira issues using fields such as `Parent Link`, `Team`, `Target start`, and `Target end`.
- `set_portfolio_fields` updates those fields only after validating that they are editable on the target issue.
- `link_dependency` creates a deduplicated Jira issue link, defaulting to `Blocks`.

## Guardrails

All write tools support the standard mutation contract:

```json
{
  "mode": "preview",
  "idempotencyKey": "premium-demo-001",
  "changeReason": "Explain why this change is needed"
}
```

Use `apply` only when the target is pilot-scoped, allowlisted, or explicitly approved. The MCP will not use browser or UI workarounds for missing API permissions.

## Design Decisions

- Field IDs are never hardcoded. They are discovered per tenant and stored in the local tenant model.
- JPD connections are treated as schema-discovered capabilities because their field shape can vary by tenant.
- Jira Plans access is probed explicitly. `403` and `401` are returned as diagnostic results.
- Existing V1 tools remain backward-compatible and keep treating JPD Ideas as standard Jira issues.

