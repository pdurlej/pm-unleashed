# Claude Code Deployment

This folder contains templates for importing the two MCP servers into Claude Code:

- `goals-projects-local`
- `jira-portfolio-local`

## Setup

```bash
cd ~/Developer/pm-unleashed
npm ci
npm run build
cp deploy/claude-code/atlassian.env.example .env
```

Fill `.env` with your Atlassian credentials:

```bash
ATLASSIAN_EMAIL=you@example.com
ATLASSIAN_API_TOKEN=your-token
ATLASSIAN_CLOUD_ID=your-cloud-id
ATLASSIAN_SITE_URL=https://your-domain.atlassian.net

JIRA_USERNAME=you@example.com
JIRA_API_TOKEN=your-token
JIRA_URL=https://your-domain.atlassian.net
```

Generate a project-scoped MCP config:

```bash
npm run claude:write-config
```

Then open Claude Code from the repo root and approve the project MCP servers when prompted:

```bash
claude
/mcp
```

## Manual Import

```bash
claude mcp add --transport stdio goals-projects-local -- node "$(pwd)/scripts/claude-goals-projects-mcp.mjs"
claude mcp add --transport stdio jira-portfolio-local -- node "$(pwd)/scripts/claude-jira-portfolio-mcp.mjs"
```

## Safety

- Do not commit `.env`.
- Use `mode: "preview"` by default.
- Use `mode: "apply"` only after reviewing the preview.
- Use `MCPTEST::` prefixes for pilot writes.
