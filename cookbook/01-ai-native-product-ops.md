# AI-native Product Ops

The core pattern is to treat product management as an operating system, not a collection of meetings and disconnected tickets.

## The Loop

```text
Signals -> Product decisions -> Discovery artifacts -> Delivery work -> Adoption feedback -> Strategy updates
```

AI agents help when they can work against structured systems:

- Atlassian Goals for strategic intent and measurable outcomes.
- Atlassian Projects as portfolio-level aggregates.
- Jira Product Discovery for product bets, hypotheses, and prioritization.
- Jira Software for implementation epics and engineering work.
- Jira Assets for operational metadata when a team needs a lightweight registry.

## Human Role

The PM remains accountable for judgment:

- deciding whether a signal is meaningful;
- choosing canonical parent goals;
- approving write operations;
- resolving tradeoffs;
- explaining why something matters.

Agents are useful when they reduce coordination cost, not when they invent strategy.

## Agent Role

Agents should:

- find existing context before creating anything;
- create previews before writes;
- keep traceability links between strategy and delivery;
- write audit-friendly comments and metadata;
- flag uncertainty rather than guessing.

## Anti-patterns

- Letting agents write directly to production without preview.
- Treating every transcript sentence as a new ticket.
- Duplicating goals instead of linking contributions.
- Hardcoding Jira custom field IDs without schema discovery.
- Measuring output by number of tickets rather than decision quality.
