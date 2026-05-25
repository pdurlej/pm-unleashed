import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AtlassianGraphqlClient,
  AuditStep,
  AuditResult,
  adfToPlainText,
  buildAuditResult,
  buildBasicAuthHeader,
  DEFAULT_PILOT_PREFIX,
  embedMetadata,
  extractMetadata,
  loadGoalsProjectsEnv,
  MutationMode,
  readTenantModelConfig,
  runGuardedMutation,
  stripMetadata,
  textToAdf,
  updateTenantModelConfig,
} from "@pm-unleashed/atlassian-mcp-shared";

type GoalTypeLabel = "ORG" | "BUSINESS" | "ADOPTION" | "SUCCESS_MEASURE";

interface GoalTypeNode {
  id: string;
  kind: string;
  state: string;
  requiresParentGoal: boolean;
  name: { __typename: string; value?: string; defaultValue?: string } | null;
  namePlural: { __typename: string; value?: string; defaultValue?: string } | null;
  allowedParentTypes?: { edges: Array<{ node: { id: string } }> };
  allowedChildTypes?: { edges: Array<{ node: { id: string } }> };
}

interface GoalSummary {
  id: string;
  key: string;
  name: string;
  url?: string | null;
  description?: string | null;
  isArchived: boolean;
  creationDate?: string | null;
  owner?: { id: string; name?: string | null } | null;
  status?: { value?: string | null; score?: number | null } | null;
  targetDate?: { label?: string | null; confidence?: string | null } | null;
  parentGoal?: { id: string; key: string; name: string } | null;
  goalType?: {
    id: string;
    kind?: string | null;
    name?: { __typename: string; value?: string; defaultValue?: string } | null;
  } | null;
  tags?: { edges: Array<{ node: { name: string } }> } | null;
  projects?: { edges: Array<{ node: ProjectSummary }> } | null;
  metricTargets?: {
    edges: Array<{
      node: {
        id: string;
        startValue?: number | null;
        targetValue?: number | null;
        snapshotValue?: { value?: number | null } | null;
        metric?: {
          id: string;
          name?: string | null;
          type?: string | null;
          latestValue?: { value?: number | null } | null;
        } | null;
      };
    }>;
  } | null;
  workItems?: {
    edges: Array<{
      node:
        | {
            __typename: "JiraIssue";
            id: string;
            issueId?: string | null;
            key?: string | null;
            summary?: string | null;
            webUrl?: string | null;
          }
        | { __typename: string }
        | null;
    }>;
  } | null;
}

interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  url?: string | null;
  isArchived?: boolean;
  owner?: { id: string; name?: string | null } | null;
  state?: { value?: string | null; label?: string | null } | null;
  dueDate?: { label?: string | null; confidence?: string | null } | null;
  description?: {
    what?: string | null;
    why?: string | null;
    measurement?: string | null;
  } | null;
  goals?: { edges: Array<{ node: { id: string; key: string; name: string } }> } | null;
  linkedJiraWorkItems?: {
    edges: Array<{
      node:
        | {
            __typename: "JiraIssue";
            id: string;
            issueId?: string | null;
            key?: string | null;
            summary?: string | null;
            webUrl?: string | null;
          }
        | { __typename: string }
        | null;
    }>;
  } | null;
}

interface SearchConnection<T> {
  edges: Array<{ cursor?: string | null; node: T }>;
  pageInfo?: { hasNextPage: boolean; endCursor?: string | null } | null;
}

interface MutationErrorNode {
  message?: string | null;
}

interface TargetDateInput {
  date?: string;
  confidence?: "DAY" | "MONTH" | "QUARTER";
}

interface MutationControl {
  mode?: MutationMode;
  idempotencyKey?: string;
  changeReason?: string;
}

interface GoalMutationInput extends MutationControl {
  name: string;
  goalType: GoalTypeLabel;
  goalTypeId?: string;
  canonicalParentGoalId?: string;
  secondaryContributionRefs?: string[];
  ownerId?: string;
  targetDate?: TargetDateInput;
  description?: string;
  tags?: string[];
  accessLevel?: "OPEN_EDIT" | "OPEN_VIEW" | "RESTRICTED";
}

interface GoalUpdateInput extends MutationControl {
  goalId?: string;
  goalKey?: string;
  name?: string;
  ownerId?: string;
  targetDate?: TargetDateInput;
  description?: string;
  secondaryContributionRefs?: string[];
  tags?: string[];
  logicalGoalType?: GoalTypeLabel;
}

interface MetricTargetInput {
  name: string;
  type: "CURRENCY" | "NUMERIC" | "PERCENTAGE";
  startValue: number;
  targetValue: number;
  currentValue?: number;
}

interface GoalUpdateNoteInput {
  summary?: string;
  description: string;
}

interface GoalUpdateHighlightInput {
  summary: string;
  description: string;
  type: "LEARNING" | "RISK" | "DECISION";
}

interface GoalProgressUpdateInput extends MutationControl {
  goalId?: string;
  goalKey?: string;
  status?: string;
  score?: number;
  summary?: string;
  targetDate?: TargetDateInput;
  notes?: GoalUpdateNoteInput[];
  highlights?: GoalUpdateHighlightInput[];
  metricUpdates?: Array<{ metricTargetId: string; newValue: number }>;
}

interface ProjectMutationInput extends MutationControl {
  name: string;
  ownerId?: string;
  targetDate?: TargetDateInput;
  description?: string;
  synergyThesis?: string;
  measurement?: string;
  primaryBusinessGoalId?: string;
  secondaryGoalIds?: string[];
  tags?: string[];
}

interface ProjectUpdateInput extends MutationControl {
  projectId?: string;
  projectKey?: string;
  name?: string;
  ownerId?: string;
  description?: string;
  synergyThesis?: string;
  measurement?: string;
  targetDate?: TargetDateInput;
  status?: string;
  summary?: string;
  notes?: GoalUpdateNoteInput[];
  secondaryGoalIds?: string[];
  tags?: string[];
}

interface ProjectStatusUpdateInput extends MutationControl {
  projectId?: string;
  projectKey?: string;
  status?: string;
  summary?: string;
  targetDate?: TargetDateInput;
  notes?: GoalUpdateNoteInput[];
}

interface GoalProjectLinkInput extends MutationControl {
  goalId?: string;
  goalKey?: string;
  projectId?: string;
  projectKey?: string;
}

interface GoalWorkItemLinkInput extends MutationControl {
  goalId?: string;
  goalKey?: string;
  workItemId: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const configPath =
  process.env.ATLASSIAN_MCP_TENANT_MODEL_PATH ??
  path.join(repoRoot, "config", "tenant-model.local.json");

const GOAL_TYPE_NAME_FRAGMENT = `
  __typename
  ... on TownsquareGoalTypeCustomName {
    value
  }
  ... on TownsquareLocalizationField {
    defaultValue
  }
`;

const GOAL_TYPE_NAME_PLURAL_FRAGMENT = `
  __typename
  ... on TownsquareGoalTypeCustomNamePlural {
    value
  }
  ... on TownsquareLocalizationField {
    defaultValue
  }
`;

const GOAL_FIELDS = `
  id
  key
  name
  url
  description
  isArchived
  creationDate
  owner {
    id
    name
  }
  status {
    value
    score
  }
  targetDate {
    label
    confidence
  }
  parentGoal {
    id
    key
    name
  }
  goalType @optIn(to: "Townsquare") {
    id
    kind
    name {
      ${GOAL_TYPE_NAME_FRAGMENT}
    }
  }
  tags(first: 20) {
    edges {
      node {
        name
      }
    }
  }
  projects(first: 20) {
    edges {
      node {
        id
        key
        name
      }
    }
  }
  metricTargets(first: 20) {
    edges {
      node {
        id
        startValue
        targetValue
        snapshotValue {
          value
        }
        metric {
          id
          name
          type
          latestValue {
            value
          }
        }
      }
    }
  }
  workItems(first: 20) @optIn(to: "GraphStoreJiraEpicContributesToAtlasGoal") {
    edges {
      node {
        __typename
        ... on JiraIssue {
          id
          issueId
          key
          summary
          webUrl
        }
      }
    }
  }
`;

const PROJECT_FIELDS = `
  id
  key
  name
  url
  isArchived
  owner {
    id
    name
  }
  state {
    value
    label
  }
  dueDate {
    label
    confidence
  }
  description {
    what
    why
    measurement
  }
  goals(first: 20) {
    edges {
      node {
        id
        key
        name
      }
    }
  }
  linkedJiraWorkItems(first: 20) @optIn(to: "GraphStoreAtlasProjectTrackedOnJiraWorkItem") {
    edges {
      node {
        __typename
        ... on JiraIssue {
          id
          issueId
          key
          summary
          webUrl
        }
      }
    }
  }
`;

function createClient(): { client: AtlassianGraphqlClient; containerId: string } {
  const env = loadGoalsProjectsEnv();
  return {
    client: new AtlassianGraphqlClient({
      siteUrl: env.ATLASSIAN_SITE_URL,
      authHeader: buildBasicAuthHeader(env.ATLASSIAN_EMAIL, env.ATLASSIAN_API_TOKEN),
    }),
    containerId: `ari:cloud:townsquare::site/${env.ATLASSIAN_CLOUD_ID}`,
  };
}

function goalTypeName(value?: { value?: string; defaultValue?: string } | null): string {
  return value?.value ?? value?.defaultValue ?? "";
}

function normalizeGoal(goal: GoalSummary) {
  const descriptionText = adfToPlainText(goal.description);
  const metadata = extractMetadata(descriptionText);
  return {
    id: goal.id,
    key: goal.key,
    name: goal.name,
    url: goal.url ?? null,
    isArchived: goal.isArchived,
    owner: goal.owner ?? null,
    status: goal.status ?? null,
    targetDate: goal.targetDate ?? null,
    parentGoal: goal.parentGoal ?? null,
    goalType: {
      id: goal.goalType?.id ?? null,
      kind: goal.goalType?.kind ?? null,
      label: goalTypeName(goal.goalType?.name),
      logicalGoalType: metadata.logicalGoalType ?? null,
    },
    description: stripMetadata(descriptionText),
    metadata,
    tags: goal.tags?.edges.map((edge) => edge.node.name) ?? [],
    projects:
      goal.projects?.edges.map((edge) => ({
        id: edge.node.id,
        key: edge.node.key,
        name: edge.node.name,
      })) ?? [],
    metricTargets:
      goal.metricTargets?.edges.map((edge) => ({
        id: edge.node.id,
        metricId: edge.node.metric?.id ?? null,
        metricName: edge.node.metric?.name ?? null,
        metricType: edge.node.metric?.type ?? null,
        startValue: edge.node.startValue ?? null,
        targetValue: edge.node.targetValue ?? null,
        currentValue:
          edge.node.metric?.latestValue?.value ??
          edge.node.snapshotValue?.value ??
          null,
      })) ?? [],
    workItems:
      goal.workItems?.edges
        .filter((edge) => edge.node?.__typename === "JiraIssue")
        .map((edge) => {
          const node = edge.node as Extract<typeof edge.node, { __typename: "JiraIssue" }>;
          return {
            graphId: node.id,
            issueId: node.issueId ?? null,
            key: node.key ?? null,
            summary: node.summary ?? null,
            webUrl: node.webUrl ?? null,
          };
        }) ?? [],
  };
}

type NormalizedGoal = ReturnType<typeof normalizeGoal>;

function isSuccessMeasureGoal(goal: NormalizedGoal): boolean {
  return goal.goalType.kind === "SUCCESS_MEASURE" || goal.goalType.logicalGoalType === "SUCCESS_MEASURE";
}

function normalizeProject(project: ProjectSummary) {
  const metadata = extractMetadata(project.description?.what);
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    url: project.url ?? null,
    isArchived: project.isArchived ?? false,
    owner: project.owner ?? null,
    state: project.state ?? null,
    targetDate: project.dueDate ?? null,
    description: {
      what: stripMetadata(project.description?.what),
      why: project.description?.why ?? null,
      measurement: project.description?.measurement ?? null,
    },
    metadata,
    linkedGoals:
      project.goals?.edges.map((edge) => ({
        id: edge.node.id,
        key: edge.node.key,
        name: edge.node.name,
      })) ?? [],
    linkedWorkItems:
      project.linkedJiraWorkItems?.edges
        .filter((edge) => edge.node?.__typename === "JiraIssue")
        .map((edge) => {
          const node = edge.node as Extract<typeof edge.node, { __typename: "JiraIssue" }>;
          return {
            graphId: node.id,
            issueId: node.issueId ?? null,
            key: node.key ?? null,
            summary: node.summary ?? null,
            webUrl: node.webUrl ?? null,
          };
        }) ?? [],
  };
}

async function fetchGoalTypes(client: AtlassianGraphqlClient, containerId: string): Promise<GoalTypeNode[]> {
  const data = await client.execute<{
    goals_goalTypes: SearchConnection<GoalTypeNode>;
  }>(
    `query GoalTypes($containerId: ID!, $first: Int) {
      goals_goalTypes(containerId: $containerId, first: $first, includeDisabled: true) {
        edges {
          node {
            id
            kind
            state
            requiresParentGoal
            name {
              ${GOAL_TYPE_NAME_FRAGMENT}
            }
            namePlural {
              ${GOAL_TYPE_NAME_PLURAL_FRAGMENT}
            }
            allowedParentTypes(first: 20) {
              edges {
                node {
                  id
                }
              }
            }
            allowedChildTypes(first: 20) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }`,
    { containerId, first: 50 },
  );

  return data.goals_goalTypes.edges.map((edge: { node: GoalTypeNode }) => edge.node);
}

async function loadGoalTypeResolution(): Promise<{
  goalTypes: GoalTypeNode[];
  logicalGoalTypes: Record<string, { goalTypeId: string; strategy: string; sourceLabel: string }>;
}> {
  const { client, containerId } = createClient();
  const goalTypes = await fetchGoalTypes(client, containerId);
  const current = await readTenantModelConfig(configPath);
  const fromConfig = (current.logicalGoalTypes ?? {}) as Record<
    string,
    { goalTypeId: string; strategy: string; sourceLabel: string }
  >;
  const defaultLogicalGoalTypes = buildLogicalGoalTypeMap(goalTypes);

  if (Object.keys(fromConfig).length > 0) {
    const byId = new Map(goalTypes.map((node) => [node.id, node]));
    const logicalGoalTypes = { ...defaultLogicalGoalTypes, ...fromConfig };
    for (const [logicalType, mapping] of Object.entries(logicalGoalTypes)) {
      const liveType = byId.get(mapping.goalTypeId);
      if (!liveType || liveType.state !== "ENABLED") {
        logicalGoalTypes[logicalType] = defaultLogicalGoalTypes[logicalType] ?? mapping;
      }
    }
    return { goalTypes, logicalGoalTypes };
  }

  return { goalTypes, logicalGoalTypes: defaultLogicalGoalTypes };
}

function preferredGoalType(goalTypes: GoalTypeNode[], kind: string): GoalTypeNode | undefined {
  const candidates = goalTypes.filter((node) => node.kind === kind);
  return candidates.find((node) => node.state === "ENABLED") ?? candidates[0];
}

function buildLogicalGoalTypeMap(
  goalTypes: GoalTypeNode[],
): Record<string, { goalTypeId: string; strategy: string; sourceLabel: string }> {
  const primaryGoalType = preferredGoalType(goalTypes, "GOAL");
  const successMeasureType = preferredGoalType(goalTypes, "SUCCESS_MEASURE");
  if (!primaryGoalType || !successMeasureType) {
    throw new Error("Tenant discovery failed: expected at least one GOAL type and one SUCCESS_MEASURE type.");
  }

  return {
    ORG: {
      goalTypeId: primaryGoalType.id,
      strategy: "fallback-default-goal-type",
      sourceLabel: goalTypeName(primaryGoalType.name),
    },
    BUSINESS: {
      goalTypeId: primaryGoalType.id,
      strategy: "fallback-default-goal-type",
      sourceLabel: goalTypeName(primaryGoalType.name),
    },
    ADOPTION: {
      goalTypeId: primaryGoalType.id,
      strategy: "fallback-default-goal-type",
      sourceLabel: goalTypeName(primaryGoalType.name),
    },
    SUCCESS_MEASURE: {
      goalTypeId: successMeasureType.id,
      strategy: "native-success-measure",
      sourceLabel: goalTypeName(successMeasureType.name),
    },
  };
}

async function resolveGoalIdentifier(goalId?: string, goalKey?: string): Promise<string> {
  if (goalId) {
    return goalId;
  }
  if (!goalKey) {
    throw new Error("Expected either goalId or goalKey.");
  }

  const { client, containerId } = createClient();
  const data = await client.execute<{ goals_byKey: { id: string } | null }>(
    `query GoalByKey($containerId: ID!, $goalKey: String!) {
      goals_byKey(containerId: $containerId, goalKey: $goalKey) {
        id
      }
    }`,
    { containerId, goalKey },
  );

  if (!data.goals_byKey) {
    throw new Error(`Goal "${goalKey}" was not found.`);
  }

  return data.goals_byKey.id;
}

async function resolveProjectIdentifier(projectId?: string, projectKey?: string): Promise<string> {
  if (projectId) {
    return projectId;
  }
  if (!projectKey) {
    throw new Error("Expected either projectId or projectKey.");
  }

  const { client, containerId } = createClient();
  const data = await client.execute<{ projects_byKey: { id: string } | null }>(
    `query ProjectByKey($containerId: ID!, $projectKey: String!) {
      projects_byKey(containerId: $containerId, projectKey: $projectKey) {
        id
      }
    }`,
    { containerId, projectKey },
  );

  if (!data.projects_byKey) {
    throw new Error(`Project "${projectKey}" was not found.`);
  }

  return data.projects_byKey.id;
}

export async function discoverTenantModel() {
  const { client, containerId } = createClient();
  const goalTypes = await fetchGoalTypes(client, containerId);
  const primaryGoalType = preferredGoalType(goalTypes, "GOAL");
  const successMeasureType = preferredGoalType(goalTypes, "SUCCESS_MEASURE");

  if (!primaryGoalType || !successMeasureType) {
    throw new Error("Tenant discovery failed: missing GOAL or SUCCESS_MEASURE type.");
  }

  const warnings: string[] = [];
  const distinctGoalTypes = goalTypes.filter((node) => node.kind === "GOAL");
  if (distinctGoalTypes.length < 3) {
    warnings.push(
      "Tenant does not expose dedicated ORG/BUSINESS/ADOPTION goal types. Logical types were mapped to the single native Goal type and will be differentiated through MCP metadata.",
    );
  }

  const config = await updateTenantModelConfig(configPath, (current: Record<string, unknown>) => ({
    ...current,
    tenant: {
      ...(current.tenant as Record<string, unknown> | undefined),
      containerId,
      discoveredAt: new Date().toISOString(),
    },
    goalTypeMap: Object.fromEntries(
      goalTypes.map((node) => [
        goalTypeName(node.name) || node.id,
        {
          id: node.id,
          kind: node.kind,
          state: node.state,
          requiresParentGoal: node.requiresParentGoal,
          name: goalTypeName(node.name),
          namePlural: goalTypeName(node.namePlural),
        },
      ]),
    ),
    logicalGoalTypes: {
      ORG: {
        goalTypeId: primaryGoalType.id,
        strategy: "fallback-default-goal-type",
        sourceLabel: goalTypeName(primaryGoalType.name),
      },
      BUSINESS: {
        goalTypeId: primaryGoalType.id,
        strategy: "fallback-default-goal-type",
        sourceLabel: goalTypeName(primaryGoalType.name),
      },
      ADOPTION: {
        goalTypeId: primaryGoalType.id,
        strategy: "fallback-default-goal-type",
        sourceLabel: goalTypeName(primaryGoalType.name),
      },
      SUCCESS_MEASURE: {
        goalTypeId: successMeasureType.id,
        strategy: "native-success-measure",
        sourceLabel: goalTypeName(successMeasureType.name),
      },
    },
    secondaryContribution: {
      strategy: "description_metadata",
      marker: "secondaryContributionRefs",
      tagConvention: "org:<slug>",
    },
    pilot: {
      namePrefix: "MCPTEST::",
      tags: ["mcp-pilot", "do-not-report"],
    },
    warnings,
  }));

  return {
    warnings,
    goalTypes: goalTypes.map((node) => ({
      id: node.id,
      kind: node.kind,
      state: node.state,
      requiresParentGoal: node.requiresParentGoal,
      name: goalTypeName(node.name),
      namePlural: goalTypeName(node.namePlural),
    })),
    config,
  };
}

export async function healthCheck() {
  const { client, containerId } = createClient();
  const data = await client.execute<{
    goals_search: SearchConnection<GoalSummary>;
    projects_search: SearchConnection<ProjectSummary>;
  }>(
    `query HealthCheck($goalContainerId: ID!, $projectContainerId: String!) {
      goals_search(containerId: $goalContainerId, first: 1) {
        edges {
          node {
            id
            key
            name
          }
        }
      }
      projects_search(containerId: $projectContainerId, searchString: "", first: 1) {
        edges {
          node {
            id
            key
            name
          }
        }
      }
    }`,
    {
      goalContainerId: containerId,
      projectContainerId: containerId,
    },
  );

  return {
    ok: true,
    siteContainerId: containerId,
    goalSample: data.goals_search.edges[0]?.node ?? null,
    projectSample: data.projects_search.edges[0]?.node ?? null,
  };
}

export async function listGoalTypes() {
  const resolution = await loadGoalTypeResolution();
  return {
    logicalGoalTypes: resolution.logicalGoalTypes,
    goalTypes: resolution.goalTypes.map((node) => ({
      id: node.id,
      kind: node.kind,
      state: node.state,
      requiresParentGoal: node.requiresParentGoal,
      name: goalTypeName(node.name),
      namePlural: goalTypeName(node.namePlural),
    })),
  };
}

export async function searchGoals(input: {
  searchString?: string;
  first?: number;
  after?: string;
}) {
  const { client, containerId } = createClient();
  const data = await client.execute<{ goals_search: SearchConnection<GoalSummary> }>(
    `query SearchGoals($containerId: ID!, $searchString: String, $first: Int, $after: String) {
      goals_search(containerId: $containerId, searchString: $searchString, first: $first, after: $after) {
        edges {
          cursor
          node {
            ${GOAL_FIELDS}
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`,
    {
      containerId,
      searchString: input.searchString ?? undefined,
      first: input.first ?? 20,
      after: input.after ?? undefined,
    },
  );

  return {
    pageInfo: data.goals_search.pageInfo ?? null,
    items: data.goals_search.edges.map((edge: { node: GoalSummary }) => normalizeGoal(edge.node)),
  };
}

export async function getGoal(input: { goalId?: string; goalKey?: string }) {
  const goalId = await resolveGoalIdentifier(input.goalId, input.goalKey);
  const { client } = createClient();
  const data = await client.execute<{ goals_byId: GoalSummary | null }>(
    `query GoalById($goalId: ID!) {
      goals_byId(goalId: $goalId) {
        ${GOAL_FIELDS}
      }
    }`,
    { goalId },
  );

  if (!data.goals_byId) {
    throw new Error(`Goal "${input.goalId ?? input.goalKey}" was not found.`);
  }

  return normalizeGoal(data.goals_byId);
}

function composeGoalDescription(input: {
  description?: string;
  logicalGoalType: GoalTypeLabel;
  secondaryContributionRefs?: string[];
  tags?: string[];
  idempotencyKey?: string;
}): string | undefined {
  if (
    !input.description &&
    !input.secondaryContributionRefs?.length &&
    !input.tags?.length &&
    !input.idempotencyKey
  ) {
    return undefined;
  }

  return embedMetadata(input.description ?? "", {
    idempotencyKey: input.idempotencyKey,
    logicalGoalType: input.logicalGoalType,
    secondaryContributionRefs: input.secondaryContributionRefs ?? [],
    tags: input.tags ?? [],
    pilot: (input.tags ?? []).includes("mcp-pilot"),
  });
}

function composeProjectDescription(input: {
  description?: string;
  synergyThesis?: string;
  measurement?: string;
  secondaryGoalIds?: string[];
  tags?: string[];
  idempotencyKey?: string;
}) {
  if (
    !input.description &&
    !input.synergyThesis &&
    !input.measurement &&
    !(input.secondaryGoalIds?.length) &&
    !(input.tags?.length) &&
    !input.idempotencyKey
  ) {
    return undefined;
  }

  return {
    what: embedMetadata(input.description ?? "", {
      idempotencyKey: input.idempotencyKey,
      secondaryGoalRefs: input.secondaryGoalIds ?? [],
      tags: input.tags ?? [],
      pilot: (input.tags ?? []).includes("mcp-pilot"),
    }),
    why: input.synergyThesis ?? "",
    measurement: input.measurement ?? "",
  };
}

async function resolveGoalTypeId(input: GoalMutationInput): Promise<string> {
  if (input.goalTypeId) {
    return input.goalTypeId;
  }
  const resolution = await loadGoalTypeResolution();
  const mapped = resolution.logicalGoalTypes[input.goalType];
  if (!mapped) {
    throw new Error(`No goal type mapping found for logical goal type "${input.goalType}".`);
  }
  return mapped.goalTypeId;
}

function assertGoalCreateModel(input: GoalMutationInput): void {
  if (input.goalType === "ORG" && input.canonicalParentGoalId) {
    throw new Error("Org Goal must not have a canonical parent in the V1 model.");
  }

  if (
    (input.goalType === "BUSINESS" ||
      input.goalType === "ADOPTION" ||
      input.goalType === "SUCCESS_MEASURE") &&
    !input.canonicalParentGoalId
  ) {
    throw new Error(`${input.goalType} goal requires canonicalParentGoalId in the V1 model.`);
  }
}

function assertProjectCreateModel(input: ProjectMutationInput): void {
  if (!input.primaryBusinessGoalId) {
    throw new Error("Atlassian Project requires primaryBusinessGoalId in the V1 model.");
  }
}

async function findExistingGoalForCreate(input: GoalMutationInput) {
  if (!input.idempotencyKey) {
    return undefined;
  }

  const result = await searchGoals({ searchString: input.name, first: 50 });
  return result.items.find(
    (item) =>
      item.name === input.name &&
      (item.metadata.idempotencyKey === input.idempotencyKey ||
        item.name.startsWith(DEFAULT_PILOT_PREFIX)),
  );
}

async function findExistingProjectForCreate(input: ProjectMutationInput) {
  if (!input.idempotencyKey) {
    return undefined;
  }

  const result = await searchProjects({ searchString: input.name, first: 50 });
  return result.items.find(
    (item) =>
      item.name === input.name &&
      (item.metadata.idempotencyKey === input.idempotencyKey ||
        item.name.startsWith(DEFAULT_PILOT_PREFIX)),
  );
}

function mutationErrorMessage(operation: string, errors?: MutationErrorNode[] | null): string {
  const messages = errors
    ?.map((error) => error.message)
    .filter((message): message is string => Boolean(message?.trim()));
  return messages?.length
    ? `${operation} failed: ${messages.join("; ")}`
    : `${operation} failed without a returned error message.`;
}

function slugForIdempotency(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function successMeasureIdempotencyKey(parentGoal: NormalizedGoal, measure: MetricTargetInput, baseKey?: string): string | undefined {
  if (!baseKey) {
    return undefined;
  }
  return `${baseKey}:success-measure:${parentGoal.key}:${slugForIdempotency(measure.name)}`;
}

function goalPilotTags(goal: NormalizedGoal): string[] {
  return Array.from(new Set([...(goal.metadata.tags ?? []), ...goal.tags]));
}

async function findExistingSuccessMeasureGoal(
  parentGoal: NormalizedGoal,
  measure: MetricTargetInput,
  baseIdempotencyKey?: string,
): Promise<NormalizedGoal | undefined> {
  const derivedKey = successMeasureIdempotencyKey(parentGoal, measure, baseIdempotencyKey);
  const result = await searchGoals({ searchString: measure.name, first: 50 });
  const exactChildren = result.items.filter(
    (item) => item.name === measure.name && item.parentGoal?.id === parentGoal.id && isSuccessMeasureGoal(item),
  );

  if (derivedKey) {
    const byIdempotency = exactChildren.find((item) => item.metadata.idempotencyKey === derivedKey);
    if (byIdempotency) {
      return byIdempotency;
    }
  }

  return exactChildren.find((item) => item.name.startsWith(DEFAULT_PILOT_PREFIX)) ?? exactChildren[0];
}

function metricTargetByName(goal: NormalizedGoal, name: string) {
  return goal.metricTargets.find((metric) => metric.metricName === name);
}

export async function createGoal(input: GoalMutationInput): Promise<AuditResult<unknown>> {
  assertGoalCreateModel(input);
  const mode = input.mode ?? "preview";
  const goalTypeId = await resolveGoalTypeId(input);
  const { client, containerId } = createClient();
  const descriptionText = composeGoalDescription({
    description: input.description,
    logicalGoalType: input.goalType,
    secondaryContributionRefs: input.secondaryContributionRefs,
    tags: input.tags,
    idempotencyKey: input.idempotencyKey,
  });
  const description = descriptionText ? textToAdf(descriptionText) : undefined;

  const mutationInput = {
    containerId,
    name: input.name,
    goalTypeId,
    ownerId: input.ownerId,
    targetDate: input.targetDate,
    description,
    parentGoalId: input.canonicalParentGoalId,
    accessLevel: input.accessLevel,
  };

  const preview = buildAuditResult(
    {
      intent: "Create Atlassian Goal",
      target: input.name,
      warnings: [],
      steps: [
        {
          kind: "graphql",
          description: "Create goal with canonical parent and metadata-backed logical typing.",
          operation: "goals_create",
          input: mutationInput,
        },
      ],
      rollbackHint: "Archive the created goal manually if the structure is incorrect.",
      result: {
        logicalGoalType: input.goalType,
        secondaryContributionRefs: input.secondaryContributionRefs ?? [],
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "goals.create_goal",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      name: input.name,
      tags: input.tags,
    },
    fingerprintInput: mutationInput,
    preview,
    apply: async () => {
      const existing = await findExistingGoalForCreate(input);
      if (existing) {
        return {
          ...buildAuditResult(
            {
              intent: preview.intent,
              target: existing.key,
              warnings: ["Reused an existing pilot goal matched by idempotency metadata or exact pilot name."],
              steps: preview.steps,
              rollbackHint: preview.rollbackHint,
              result: existing,
            },
            mode,
            false,
          ),
          deduplicated: true,
        };
      }

      const data = await client.execute<{
        goals_create: {
          success: boolean;
          errors?: MutationErrorNode[] | null;
          goal: GoalSummary | null;
        };
      }>(
        `mutation CreateGoal($input: TownsquareGoalsCreateInput!) {
          goals_create(input: $input) {
            success
            errors {
              message
            }
            goal {
              ${GOAL_FIELDS}
            }
          }
        }`,
        { input: mutationInput },
      );

      if (!data.goals_create.success) {
        throw new Error(mutationErrorMessage("goals_create", data.goals_create.errors));
      }

      if (!data.goals_create.goal) {
        const createdButNotReturned = await findExistingGoalForCreate(input);
        if (createdButNotReturned) {
          return {
            ...buildAuditResult(
              {
                intent: preview.intent,
                target: createdButNotReturned.key,
                warnings: [
                  "goals_create returned success but no goal payload; reused the pilot goal found by read-back search.",
                ],
                steps: preview.steps,
                rollbackHint: preview.rollbackHint,
                result: createdButNotReturned,
              },
              mode,
              true,
            ),
            deduplicated: true,
          };
        }
        throw new Error("goals_create returned success but no goal payload and read-back search did not find the created goal.");
      }

      return buildAuditResult(
        {
          intent: preview.intent,
          target: input.name,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: normalizeGoal(data.goals_create.goal),
        },
        mode,
        true,
      );
    },
  });
}

export async function updateGoal(input: GoalUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const goal = await getGoal({ goalId: input.goalId, goalKey: input.goalKey });
  const { client } = createClient();
  const descriptionText = composeGoalDescription({
    description: input.description ?? goal.description,
    logicalGoalType: input.logicalGoalType ?? (goal.goalType.logicalGoalType as GoalTypeLabel | null) ?? "BUSINESS",
    secondaryContributionRefs: input.secondaryContributionRefs ?? (goal.metadata.secondaryContributionRefs ?? []),
    tags: input.tags ?? (goal.metadata.tags ?? []),
  });
  const description = descriptionText ? textToAdf(descriptionText) : undefined;

  const mutationInput = {
    goalId: goal.id,
    name: input.name,
    ownerId: input.ownerId,
    description,
    targetDate: input.targetDate,
  };

  const preview = buildAuditResult(
    {
      intent: "Update Atlassian Goal",
      target: goal.key,
      warnings: [],
      steps: [
        {
          kind: "graphql",
          description: "Update goal fields and refresh MCP metadata in the description payload.",
          operation: "goals_edit",
          input: mutationInput,
          before: goal,
        },
      ],
      rollbackHint: "Re-run update_goal with the previous description and fields if rollback is needed.",
      result: {
        before: goal,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "goals.update_goal",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: goal.name,
      existingTags: goal.metadata.tags,
      name: input.name,
      tags: input.tags,
    },
    fingerprintInput: mutationInput,
    preview,
    apply: async () => {
      const data = await client.execute<{ goals_edit: { goal: GoalSummary } }>(
        `mutation UpdateGoal($input: TownsquareGoalsEditInput) {
          goals_edit(input: $input) {
            goal {
              ${GOAL_FIELDS}
            }
          }
        }`,
        { input: mutationInput },
      );

      return buildAuditResult(
        {
          intent: preview.intent,
          target: goal.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: normalizeGoal(data.goals_edit.goal),
        },
        mode,
        true,
      );
    },
  });
}

export async function upsertSuccessMeasures(input: {
  goalId?: string;
  goalKey?: string;
  measures: MetricTargetInput[];
  mode?: MutationMode;
  idempotencyKey?: string;
  changeReason?: string;
}): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const goal = await getGoal({ goalId: input.goalId, goalKey: input.goalKey });
  const targetPlans = await Promise.all(
    input.measures.map(async (measure) => {
      const targetGoal = isSuccessMeasureGoal(goal)
        ? goal
        : await findExistingSuccessMeasureGoal(goal, measure, input.idempotencyKey);
      return {
        measure,
        targetGoal,
        existingMetricTarget: targetGoal ? metricTargetByName(targetGoal, measure.name) : undefined,
      };
    }),
  );

  const plannedSteps = targetPlans.flatMap(({ measure, targetGoal, existingMetricTarget }): AuditStep[] => {
    const steps: AuditStep[] = [];
    if (!isSuccessMeasureGoal(goal)) {
      steps.push({
        kind: targetGoal ? "note" : "graphql",
        description: targetGoal
          ? `Reuse existing Success Measure "${measure.name}" under "${goal.key}".`
          : `Create Success Measure "${measure.name}" under "${goal.key}" before attaching a metric target.`,
        operation: targetGoal ? "goals_search" : "goals_create",
        input: targetGoal
          ? { goalId: targetGoal.id, goalKey: targetGoal.key, parentGoalId: goal.id }
          : {
              name: measure.name,
              goalType: "SUCCESS_MEASURE",
              canonicalParentGoalId: goal.id,
              idempotencyKey: successMeasureIdempotencyKey(goal, measure, input.idempotencyKey),
            },
      });
    }

    const metricGoalId = targetGoal?.id ?? `pending-success-measure:${measure.name}`;
    steps.push(
      existingMetricTarget
        ? {
            kind: "graphql",
            description: `Update metric target "${measure.name}".`,
            operation: "goals_editMetricTarget",
            input: {
              metricTargetId: existingMetricTarget.id,
              startValue: measure.startValue,
              targetValue: measure.targetValue,
              currentValue: measure.currentValue,
            },
          }
        : {
            kind: "graphql",
            description: `Create metric target "${measure.name}".`,
            operation: "goals_createAndAddMetricTarget",
            input: {
              goalId: metricGoalId,
              createMetric: {
                goalId: metricGoalId,
                name: measure.name,
                type: measure.type,
                value: measure.currentValue ?? measure.startValue,
              },
              startValue: measure.startValue,
              targetValue: measure.targetValue,
            },
          },
    );
    return steps;
  });

  const preview = buildAuditResult(
    {
      intent: "Upsert goal success measures",
      target: goal.key,
      warnings: [],
      steps: plannedSteps,
      rollbackHint: "Edit or archive created Success Measures and metric targets manually if a pilot change should be reverted.",
      result: {
        before: targetPlans.map(({ measure, targetGoal, existingMetricTarget }) => ({
          measure: measure.name,
          targetGoal: targetGoal
            ? { id: targetGoal.id, key: targetGoal.key, name: targetGoal.name }
            : null,
          existingMetricTarget: existingMetricTarget ?? null,
        })),
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "goals.upsert_success_measures",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: goal.name,
      existingTags: goal.metadata.tags,
    },
    fingerprintInput: {
      goalId: goal.id,
      measures: input.measures,
    },
    preview,
    apply: async () => {
      const changedGoalIds = new Set<string>();
      for (const measure of input.measures) {
        let targetGoal = isSuccessMeasureGoal(goal)
          ? goal
          : await findExistingSuccessMeasureGoal(goal, measure, input.idempotencyKey);

        if (!targetGoal) {
          const created = await createGoal({
            mode: "apply",
            idempotencyKey: successMeasureIdempotencyKey(goal, measure, input.idempotencyKey),
            changeReason: input.changeReason,
            name: measure.name,
            goalType: "SUCCESS_MEASURE",
            canonicalParentGoalId: goal.id,
            description: `Success Measure for ${goal.key}: ${measure.name}`,
            tags: goalPilotTags(goal),
          });
          targetGoal = created.result as NormalizedGoal | undefined;
          if (!targetGoal?.id) {
            throw new Error(`Could not create or resolve Success Measure "${measure.name}" under goal "${goal.key}".`);
          }
        }

        const existing = metricTargetByName(targetGoal, measure.name);
        if (existing) {
          const data = await createClient().client.execute<{
            goals_editMetricTarget: {
              success: boolean;
              errors?: Array<{ message: string }> | null;
            };
          }>(
            `mutation EditMetricTarget($input: TownsquareGoalsEditMetricTargetInput!) {
              goals_editMetricTarget(input: $input) {
                success
                errors {
                  message
                }
              }
            }`,
            {
              input: {
                metricTargetId: existing.id,
                startValue: measure.startValue,
                targetValue: measure.targetValue,
                currentValue: measure.currentValue,
              },
            },
          );
          if (!data.goals_editMetricTarget.success) {
            throw new Error(mutationErrorMessage("goals_editMetricTarget", data.goals_editMetricTarget.errors));
          }
        } else {
          const data = await createClient().client.execute<{
            goals_createAndAddMetricTarget: {
              success: boolean;
              errors?: Array<{ message: string }> | null;
            };
          }>(
            `mutation CreateMetricTarget($input: TownsquareGoalsCreateAddMetricTargetInput!) {
              goals_createAndAddMetricTarget(input: $input) {
                success
                errors {
                  message
                }
              }
            }`,
            {
              input: {
                goalId: targetGoal.id,
                createMetric: {
                  goalId: targetGoal.id,
                  name: measure.name,
                  type: measure.type,
                  value: measure.currentValue ?? measure.startValue,
                },
                startValue: measure.startValue,
                targetValue: measure.targetValue,
              },
            },
          );
          if (!data.goals_createAndAddMetricTarget.success) {
            throw new Error(
              mutationErrorMessage("goals_createAndAddMetricTarget", data.goals_createAndAddMetricTarget.errors),
            );
          }
        }
        changedGoalIds.add(targetGoal.id);
      }

      const after = await Promise.all([...changedGoalIds].map((goalId) => getGoal({ goalId })));
      return buildAuditResult(
        {
          intent: preview.intent,
          target: goal.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: {
            parentGoal: isSuccessMeasureGoal(goal) ? goal.parentGoal : { id: goal.id, key: goal.key, name: goal.name },
            successMeasures: after,
          },
        },
        mode,
        true,
      );
    },
  });
}

export async function createGoalUpdate(input: GoalProgressUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const goalId = await resolveGoalIdentifier(input.goalId, input.goalKey);
  const goal = await getGoal({ goalId });
  const mutationInput = {
    goalId,
    status: input.status,
    score: input.score,
    summary: input.summary ? textToAdf(input.summary) : undefined,
    targetDate: input.targetDate,
    updateNotes: input.notes?.map((note) => ({
      summary: note.summary,
      description: textToAdf(note.description),
    })),
    metricUpdate: input.metricUpdates?.map((metric) => ({
      targetId: metric.metricTargetId,
      newValue: metric.newValue,
    })),
    highlights: input.highlights?.map((highlight) => ({
      summary: highlight.summary,
      description: textToAdf(highlight.description),
      type: highlight.type,
    })),
    isBundledUpdate: false,
  };

  const preview = buildAuditResult(
    {
      intent: "Create goal progress update",
      target: goal.key,
      warnings: [],
      steps: [
        {
          kind: "graphql",
          description: "Create a goal update with optional note, highlight, and metric deltas.",
          operation: "goals_createUpdate",
          input: mutationInput,
        },
      ],
      rollbackHint: "Delete the latest goal update from the Goals UI if needed.",
      result: {
        before: {
          status: goal.status,
          targetDate: goal.targetDate,
        },
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "goals.create_goal_update",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: goal.name,
      existingTags: goal.metadata.tags,
    },
    fingerprintInput: mutationInput,
    preview,
    apply: async () => {
      const data = await createClient().client.execute<{ goals_createUpdate: { goal: GoalSummary } }>(
        `mutation CreateGoalUpdate($input: TownsquareGoalsCreateUpdateInput) {
          goals_createUpdate(input: $input) {
            goal {
              ${GOAL_FIELDS}
            }
          }
        }`,
        { input: mutationInput },
      );

      return buildAuditResult(
        {
          intent: preview.intent,
          target: goal.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: normalizeGoal(data.goals_createUpdate.goal),
        },
        mode,
        true,
      );
    },
  });
}

export async function searchProjects(input: {
  searchString?: string;
  first?: number;
  after?: string;
}) {
  const { client, containerId } = createClient();
  const data = await client.execute<{ projects_search: SearchConnection<ProjectSummary> }>(
    `query SearchProjects($containerId: String!, $searchString: String!, $first: Int, $after: String) {
      projects_search(containerId: $containerId, searchString: $searchString, first: $first, after: $after) {
        edges {
          cursor
          node {
            ${PROJECT_FIELDS}
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`,
    {
      containerId,
      searchString: input.searchString ?? "",
      first: input.first ?? 20,
      after: input.after ?? undefined,
    },
  );

  return {
    pageInfo: data.projects_search.pageInfo ?? null,
    items: data.projects_search.edges.map((edge: { node: ProjectSummary }) => normalizeProject(edge.node)),
  };
}

export async function getProject(input: { projectId?: string; projectKey?: string }) {
  const projectId = await resolveProjectIdentifier(input.projectId, input.projectKey);
  const { client } = createClient();
  const data = await client.execute<{ projects_byId: ProjectSummary | null }>(
    `query ProjectById($projectId: String!) {
      projects_byId(projectId: $projectId) {
        ${PROJECT_FIELDS}
      }
    }`,
    { projectId },
  );

  if (!data.projects_byId) {
    throw new Error(`Project "${input.projectId ?? input.projectKey}" was not found.`);
  }

  return normalizeProject(data.projects_byId);
}

export async function createProject(input: ProjectMutationInput): Promise<AuditResult<unknown>> {
  assertProjectCreateModel(input);
  const mode = input.mode ?? "preview";
  const { client, containerId } = createClient();
  const createInput = {
    containerId,
    name: input.name,
    targetDate: input.targetDate,
    private: false,
  };
  const editDescription = composeProjectDescription({
    description: input.description,
    synergyThesis: input.synergyThesis,
    measurement: input.measurement,
    secondaryGoalIds: input.secondaryGoalIds,
    tags: input.tags,
    idempotencyKey: input.idempotencyKey,
  });

  const previewSteps: AuditStep[] = [
    {
      kind: "graphql" as const,
      description: "Create the Atlassian Project shell.",
      operation: "projects_create",
      input: createInput,
    },
  ];

  if (input.ownerId || editDescription) {
    previewSteps.push({
      kind: "graphql" as const,
      description: "Enrich the project with owner and description metadata.",
      operation: "projects_edit",
      input: {
        owner: input.ownerId,
        description: editDescription,
      },
    });
  }
  if (input.primaryBusinessGoalId) {
    previewSteps.push({
      kind: "graphql" as const,
      description: "Link the primary business goal to the new project.",
      operation: "projects_addGoalLink",
      input: {
        goalId: input.primaryBusinessGoalId,
      },
    });
  }
  for (const goalId of input.secondaryGoalIds ?? []) {
    previewSteps.push({
      kind: "graphql" as const,
      description: `Link secondary goal ${goalId}.`,
      operation: "projects_addGoalLink",
      input: {
        goalId,
      },
    });
  }

  const preview = buildAuditResult(
    {
      intent: "Create Atlassian Project",
      target: input.name,
      warnings: [],
      steps: previewSteps,
      rollbackHint: "Archive the project and remove linked goals from the UI if rollback is needed.",
      result: {
        primaryBusinessGoalId: input.primaryBusinessGoalId ?? null,
        secondaryGoalIds: input.secondaryGoalIds ?? [],
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "projects.create_project",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      name: input.name,
      tags: input.tags,
    },
    fingerprintInput: {
      createInput,
      editDescription,
      ownerId: input.ownerId,
      linkedGoalIds: [input.primaryBusinessGoalId, ...(input.secondaryGoalIds ?? [])].filter(Boolean),
    },
    preview,
    apply: async () => {
      const existing = await findExistingProjectForCreate(input);
      let projectId = existing?.id;
      let appliedMutation = false;

      if (!projectId) {
        const created = await client.execute<{ projects_create: { project: { id: string } } }>(
          `mutation CreateProject($input: TownsquareProjectsCreateInput!) {
            projects_create(input: $input) {
              project {
                id
              }
            }
          }`,
          { input: createInput },
        );

        projectId = created.projects_create.project.id;
        appliedMutation = true;
      }

      if (input.ownerId || editDescription) {
        await client.execute(
          `mutation EditProject($input: TownsquareProjectsEditInput) {
            projects_edit(input: $input) {
              project {
                id
              }
            }
          }`,
          {
            input: {
              id: projectId,
              owner: input.ownerId,
              description: editDescription,
            },
          },
        );
        appliedMutation = true;
      }

      const goalIds = [input.primaryBusinessGoalId, ...(input.secondaryGoalIds ?? [])].filter(
        (value): value is string => Boolean(value),
      );
      const currentProject = await getProject({ projectId });
      const linkedGoalIds = new Set(currentProject.linkedGoals.map((goal) => goal.id));
      for (const goalId of goalIds) {
        if (linkedGoalIds.has(goalId)) {
          continue;
        }
        await client.execute(
          `mutation AddGoalLink($input: TownsquareProjectsAddGoalLink!) {
            projects_addGoalLink(input: $input) {
              project {
                id
              }
            }
          }`,
          {
            input: {
              projectId,
              goalId,
            },
          },
        );
        appliedMutation = true;
      }

      const after = await getProject({ projectId });
      return {
        ...buildAuditResult(
          {
            intent: preview.intent,
            target: input.name,
            warnings: existing
              ? ["Reused an existing pilot project matched by idempotency metadata or exact pilot name."]
              : [],
            steps: preview.steps,
            rollbackHint: preview.rollbackHint,
            result: after,
          },
          mode,
          appliedMutation,
        ),
        deduplicated: Boolean(existing && !appliedMutation),
      };
    },
  });
}

export async function updateProject(input: ProjectUpdateInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const project = await getProject({ projectId: input.projectId, projectKey: input.projectKey });
  const editDescription = composeProjectDescription({
    description: input.description ?? project.description.what ?? undefined,
    synergyThesis: input.synergyThesis ?? project.description.why ?? undefined,
    measurement: input.measurement ?? project.description.measurement ?? undefined,
    secondaryGoalIds: input.secondaryGoalIds ?? (project.metadata.secondaryGoalRefs ?? []),
    tags: input.tags ?? (project.metadata.tags ?? []),
  });

  const previewSteps: AuditStep[] = [
    {
      kind: "graphql" as const,
      description: "Update project metadata fields.",
      operation: "projects_edit",
      input: {
        id: project.id,
        name: input.name,
        owner: input.ownerId,
        description: editDescription,
      },
      before: project,
    },
  ];

  if (input.status || input.summary || input.targetDate || input.notes?.length) {
    previewSteps.push({
      kind: "graphql" as const,
      description: "Create a project status update because Projects exposes status/target date through updates.",
      operation: "projects_createUpdate",
      input: {
        projectId: project.id,
        status: input.status,
        summary: input.summary ? textToAdf(input.summary) : undefined,
        targetDate: input.targetDate,
        updateNotes: input.notes?.map((note) => ({
          summary: note.summary,
          description: textToAdf(note.description),
        })),
      },
    });
  }

  const preview = buildAuditResult(
    {
      intent: "Update Atlassian Project",
      target: project.key,
      warnings: [],
      steps: previewSteps,
      rollbackHint: "Re-run update_project with previous metadata, then delete the status update from the UI if needed.",
      result: {
        before: project,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "projects.update_project",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: project.name,
      existingTags: project.metadata.tags,
      name: input.name,
      tags: input.tags,
    },
    fingerprintInput: {
      projectId: project.id,
      editDescription,
      ownerId: input.ownerId,
      name: input.name,
      status: input.status,
      summary: input.summary,
      targetDate: input.targetDate,
    },
    preview,
    apply: async () => {
      await createClient().client.execute(
        `mutation EditProject($input: TownsquareProjectsEditInput) {
          projects_edit(input: $input) {
            project {
              id
            }
          }
        }`,
        {
          input: {
            id: project.id,
            name: input.name,
            owner: input.ownerId,
            description: editDescription,
          },
        },
      );

      if (previewSteps.length > 1) {
        await createClient().client.execute(
          `mutation CreateProjectUpdate($input: TownsquareProjectsCreateUpdateInput) {
            projects_createUpdate(input: $input) {
              project {
                id
              }
            }
          }`,
          {
            input: {
              projectId: project.id,
              status: input.status,
              summary: input.summary ? textToAdf(input.summary) : undefined,
              targetDate: input.targetDate,
              updateNotes: input.notes?.map((note) => ({
                summary: note.summary,
                description: textToAdf(note.description),
              })),
            },
          },
        );
      }

      const after = await getProject({ projectId: project.id });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: project.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

export async function createProjectUpdate(
  input: ProjectStatusUpdateInput,
): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const project = await getProject({ projectId: input.projectId, projectKey: input.projectKey });
  const mutationInput = {
    projectId: project.id,
    status: input.status,
    summary: input.summary ? textToAdf(input.summary) : undefined,
    targetDate: input.targetDate,
    updateNotes: input.notes?.map((note) => ({
      summary: note.summary,
      description: textToAdf(note.description),
    })),
  };

  const preview = buildAuditResult(
    {
      intent: "Create project status update",
      target: project.key,
      warnings: [],
      steps: [
        {
          kind: "graphql",
          description: "Create a new project update entry.",
          operation: "projects_createUpdate",
          input: mutationInput,
        },
      ],
      rollbackHint: "Delete the latest project update from the Projects UI if it should be removed.",
      result: {
        before: project.state,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "projects.create_project_update",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: project.name,
      existingTags: project.metadata.tags,
    },
    fingerprintInput: mutationInput,
    preview,
    apply: async () => {
      await createClient().client.execute(
        `mutation CreateProjectUpdate($input: TownsquareProjectsCreateUpdateInput) {
          projects_createUpdate(input: $input) {
            project {
              id
            }
          }
        }`,
        { input: mutationInput },
      );
      const after = await getProject({ projectId: project.id });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: project.key,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

export async function linkGoalProject(input: GoalProjectLinkInput): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const goalId = await resolveGoalIdentifier(input.goalId, input.goalKey);
  const projectId = await resolveProjectIdentifier(input.projectId, input.projectKey);
  const goal = await getGoal({ goalId });
  const project = await getProject({ projectId });
  const preview = buildAuditResult(
    {
      intent: "Link goal to project",
      target: `${goal.key} <-> ${project.key}`,
      warnings: [],
      steps: [
        {
          kind: "graphql",
          description: "Create a goal-project relationship in Atlassian Projects/Goals.",
          operation: "goals_addProjectLink",
          input: {
            goalId,
            projectId,
          },
        },
      ],
      rollbackHint: "Remove the goal link from the Atlassian Project UI if needed.",
      result: {
        goal,
        project,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "goals.link_goal_project",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: goal.name,
      existingTags: goal.metadata.tags,
    },
    fingerprintInput: {
      goalId,
      projectId,
    },
    preview,
    apply: async () => {
      await createClient().client.execute(
        `mutation LinkGoalProject($input: TownsquareAddProjectLinkInput!) {
          goals_addProjectLink(input: $input) {
            goal {
              id
            }
          }
        }`,
        {
          input: {
            goalId,
            projectId,
          },
        },
      );
      const after = await getGoal({ goalId });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: preview.target,
          warnings: [],
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}

export async function linkGoalWorkItem(
  input: GoalWorkItemLinkInput,
): Promise<AuditResult<unknown>> {
  const mode = input.mode ?? "preview";
  const goalId = await resolveGoalIdentifier(input.goalId, input.goalKey);
  const goal = await getGoal({ goalId });
  const preview = buildAuditResult(
    {
      intent: "Link goal to Jira work item",
      target: `${goal.key} <-> ${input.workItemId}`,
      warnings: [
        "The MCP expects a GraphQL Jira work item id. Use the id returned from get_goal/get_project work item payloads or a prior link/search step.",
      ],
      steps: [
        {
          kind: "graphql",
          description: "Create a goal-work-item relationship.",
          operation: "goals_linkWorkItem",
          input: {
            goalId,
            workItemId: input.workItemId,
          },
        },
      ],
      rollbackHint: "Unlink the Jira work item from the goal in Atlassian Goals if needed.",
      result: {
        before: goal.workItems,
      },
    },
    mode,
    false,
  );

  return runGuardedMutation({
    actionKey: "goals.link_goal_work_item",
    mode,
    changeReason: input.changeReason,
    idempotencyKey: input.idempotencyKey,
    pilotScope: {
      existingName: goal.name,
      existingTags: goal.metadata.tags,
    },
    fingerprintInput: {
      goalId,
      workItemId: input.workItemId,
    },
    preview,
    apply: async () => {
      await createClient().client.execute(
        `mutation LinkGoalWorkItem($input: TownsquareGoalsLinkWorkItemInput!) {
          goals_linkWorkItem(input: $input) {
            goal {
              id
            }
          }
        }`,
        {
          input: {
            goalId,
            workItemId: input.workItemId,
          },
        },
      );
      const after = await getGoal({ goalId });
      return buildAuditResult(
        {
          intent: preview.intent,
          target: preview.target,
          warnings: preview.warnings,
          steps: preview.steps,
          rollbackHint: preview.rollbackHint,
          result: after,
        },
        mode,
        true,
      );
    },
  });
}
