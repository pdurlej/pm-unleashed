# Goals To Delivery Model

PM Unleashed uses a five-layer traceability model:

```text
Organization Goal -> Business Goal -> Atlassian Project -> JPD Idea -> Jira Epic
```

## Organization Goal

Represents a high-level strategic direction, such as revenue growth, cost reduction, customer retention, adoption, or operational quality.

## Business Goal

Represents a business-owned outcome that contributes to exactly one canonical organization goal.

If a business goal also contributes to other organization goals, model those as secondary contributions, not as additional parents. This avoids fighting single-parent goal hierarchy constraints.

## Atlassian Project

Represents a portfolio aggregate: a coherent bundle of product bets that together unlock more value than each bet alone.

Good Atlassian Projects have:

- a primary business goal;
- a synergy thesis;
- a clear owner;
- target timing;
- links to one or more JPD ideas.

## JPD Idea

Represents a product bet, hypothesis, problem area, or outcome candidate.

JPD is where richer product context should live:

- desired outcome;
- hypothesis;
- assumptions;
- evidence;
- prioritization;
- product/tech/adoption ownership.

## Jira Epic

Represents delivery scope for engineers.

Epics should be smaller and more implementation-focused than JPD ideas. One JPD idea may map to many Jira epics when that makes delivery easier.

## Linking Rules

- Business goals have one canonical parent.
- Secondary strategic alignment goes into metadata/tags/description.
- Atlassian Projects aggregate related JPD ideas.
- JPD ideas link to one or more Jira epics.
- Jira epics should link back to their primary JPD idea.
