# PM Unleashed

AI-native product operating system cookbook plus two local MCP servers for Atlassian Cloud.

The repo is built around a simple idea: product work should move as a traceable chain from strategy to execution, without forcing PMs to manually copy context across tools.

```text
Organization Goal -> Business Goal -> Atlassian Project -> JPD Idea -> Jira Epic
```

## What Is Inside

- `cookbook/` - practical playbooks for AI-assisted product operations.
- `apps/goals-projects-mcp/` - MCP server for Atlassian Goals and Atlassian Projects through Atlassian GraphQL.
- `apps/jira-rest-mcp/` - MCP server for Jira Product Discovery, Jira Software, and Jira Assets through REST APIs.
- `packages/atlassian-mcp-shared/` - shared auth, HTTP, guardrails, idempotency, metadata, and audit helpers.
- `deploy/` - configuration templates for Claude Code and AnythingLLM.
- `config/tenant-model.example.json` - non-secret example of discovered tenant mappings.

## Why This Exists

Most product teams already have the data they need, but it is scattered:

- goals live in strategic planning tools;
- product discovery lives in Jira Product Discovery;
- implementation lives in Jira Software;
- feedback lives in comments, forms, calls, transcripts, and ad hoc docs;
- PM decisions are often lost between these layers.

PM Unleashed turns that into an agent-operable system with guarded writes, explicit previews, audit output, and human approval.

## MCP Servers

### Goals / Projects MCP

Tools include:

- `health_check`
- `discover_tenant_model`
- `list_goal_types`
- `search_goals`
- `get_goal`
- `create_goal`
- `update_goal`
- `upsert_success_measures`
- `create_goal_update`
- `search_projects`
- `get_project`
- `create_project`
- `update_project`
- `link_goal_project`
- `link_goal_work_item`

### Jira Product Portfolio MCP

Tools include:

- `health_check`
- `discover_jira_schema`
- `search_spaces`
- `search_ideas`
- `get_idea`
- `create_idea`
- `update_idea`
- `set_idea_links`
- `search_epics`
- `get_epic`
- `create_epic`
- `update_epic`
- `link_idea_epic`
- Jira Assets tools for schema/object lookup and guarded test mutations

## Safety Model

Every write-capable tool is designed around guarded mutation control:

```json
{
  "mode": "preview",
  "idempotencyKey": "demo-001",
  "changeReason": "Explain why this change is being made"
}
```

- `preview` is the default.
- `apply` must be explicit.
- Audit output includes intent, target, before/after shape, and rollback hints.
- Pilot writes should use visible prefixes and tags such as `MCPTEST::`, `mcp-pilot`, and `do-not-report`.

## Quick Start

```bash
npm install
npm run build
cp deploy/claude-code/atlassian.env.example .env
```

Fill `.env` with your own Atlassian values:

```bash
ATLASSIAN_EMAIL=you@example.com
ATLASSIAN_API_TOKEN=your-token
ATLASSIAN_CLOUD_ID=your-cloud-id
ATLASSIAN_SITE_URL=https://your-domain.atlassian.net

JIRA_USERNAME=you@example.com
JIRA_API_TOKEN=your-token
JIRA_URL=https://your-domain.atlassian.net
```

Then discover your tenant model:

```bash
npm run bootstrap
```

`bootstrap` writes discovered schema to `config/tenant-model.local.json`, which is intentionally ignored by Git.

## Cookbook

Start here:

- [AI-native product ops](cookbook/01-ai-native-product-ops.md)
- [Goals to delivery model](cookbook/02-goals-to-delivery-model.md)
- [Feedback triage playbook](cookbook/03-feedback-triage-playbook.md)
- [Guarded writes and human approval](cookbook/04-guarded-writes-and-human-approval.md)
- [Demo prompts](cookbook/05-demo-prompts.md)

## Status

This is a reference implementation, not an official Atlassian product. Atlassian APIs, especially Goals and Projects GraphQL APIs, may change. Use `preview` first and test against a pilot subset before enabling write operations.

## License

MIT. See [DISCLAIMER.md](DISCLAIMER.md) and [SECURITY.md](SECURITY.md) before using this with production Jira data.
