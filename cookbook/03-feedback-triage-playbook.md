# Feedback Triage Playbook

Feedback is not backlog. Feedback is raw signal.

## Triage Buckets

Use a small set of decisions:

- `Reject` - test, duplicate, irrelevant, or unsupported by evidence.
- `Park` - potentially useful, but not actionable now.
- `Clarify` - needs owner, context, example, or expected impact.
- `Discover` - meaningful signal worth product analysis.
- `Commit` - already accepted into delivery or linked to active work.

## Triage Questions

For each feedback item, ask:

- What problem is being reported?
- Who experiences it?
- Is this a single case or a recurring pattern?
- Does it connect to an existing goal, project, or idea?
- Is the next action product discovery, engineering delivery, support, or rejection?
- What would need to be true for this to become a JPD idea?

## Agent Workflow

An agent can safely help by:

- listing feedback items by status and age;
- grouping them by product area;
- identifying obvious tests and junk;
- proposing comments and transitions;
- linking feedback to existing JPD ideas;
- surfacing unassigned or stale items.

The agent should not silently close ambiguous feedback. It should propose a batch and wait for human approval.

## Comment Template

```text
Triage YYYY-MM-DD: closing this feedback as [reason].

Rationale:
- [short reason]
- [evidence or lack of evidence]

If this signal reappears, reopen or link it to a new discovery item with concrete examples.
```
