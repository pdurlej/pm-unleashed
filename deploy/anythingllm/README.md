# AnythingLLM Deployment

This folder contains templates for running the two MCP servers in AnythingLLM:

- `goals-projects-mcp` - Atlassian Goals and Projects.
- `jira-portfolio-mcp` - Jira Product Discovery, Jira Software, and Jira Assets.

## Requirements

- AnythingLLM Desktop or self-hosted AnythingLLM with MCP enabled.
- Node.js.
- A personal Atlassian API token.
- This repository installed and built locally.

```bash
npm ci
npm run build
```

## Desktop Setup

Generate a local config:

```bash
npm run anythingllm:write-config
```

Then fill the empty env values in:

```text
deploy/anythingllm/generated/anythingllm_mcp_servers.json
```

Copy the two server entries into your AnythingLLM MCP config.

## Docker Setup

Place this repo under the AnythingLLM storage path, for example:

```text
$STORAGE_LOCATION/mcp/pm-unleashed
```

Build inside that directory:

```bash
npm ci
npm run build
```

Then use:

```text
deploy/anythingllm/anythingllm_mcp_servers.docker.template.json
```

as the shape for your AnythingLLM MCP config.

## Environment Values

```bash
ATLASSIAN_EMAIL=you@example.com
ATLASSIAN_API_TOKEN=your-token
ATLASSIAN_CLOUD_ID=your-cloud-id
ATLASSIAN_SITE_URL=https://your-domain.atlassian.net

JIRA_USERNAME=you@example.com
JIRA_API_TOKEN=your-token
JIRA_URL=https://your-domain.atlassian.net
```

`ATLASSIAN_API_TOKEN` and `JIRA_API_TOKEN` may be the same token when both belong to the same Atlassian account.

## Safety

- Start with read-only prompts.
- Use `mode: "preview"` before every write.
- Use `mode: "apply"` only for reviewed pilot changes.
- Use visible pilot markers such as `MCPTEST::`, `mcp-pilot`, and `do-not-report`.
- Do not share a single API token across teammates.
