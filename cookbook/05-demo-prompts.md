# Demo Prompts

## Read-only Health Check

```text
Use the available Atlassian MCP tools in read-only mode.

1. Run health checks for both MCP servers.
2. List available goal types.
3. Search for goals related to "growth".
4. Search Jira Product Discovery spaces.
5. Search three JPD ideas in a product discovery project.
6. Search three Jira epics in a software project.
7. Summarize what you can read and what permissions appear to be missing.

Do not call any tool with mode="apply".
```

## Preview-only Strategy To Delivery Chain

```text
Prepare a preview-only chain:

Organization Goal -> Business Goal -> Atlassian Project -> JPD Idea -> Jira Epic

Use mode="preview" for every write-capable call.

Create a proposed business goal, a portfolio project, a JPD idea, and one Jira epic. Return the planned payloads, expected links, risks, and any schema assumptions. Do not apply changes.
```

## Feedback Triage

```text
Review all Jira Product Discovery feedback items in the selected project.

Group them into:
- close as test/junk
- duplicate or already represented
- needs clarification
- promote to discovery
- link to existing work

Do not change Jira yet. Return a batch proposal with issue keys, recommended action, and proposed comment.
```

## Apply Pilot

```text
Run a small production pilot with explicit guarded writes.

Rules:
- use mode="apply" only after showing a preview;
- use name prefix MCPTEST::;
- add pilot tags mcp-pilot and do-not-report where possible;
- stop immediately on the first API error;
- return direct links to every created or changed entity.
```
