import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  assetsHealthCheck,
  createAssetObject,
  createEpic,
  createIdea,
  createPlan,
  deleteAssetObject,
  discoverJpdConnections,
  discoverJiraSchema,
  discoverPremiumCapabilities,
  getAssetObject,
  getAssetObjectAttributes,
  getAssetObjectType,
  getEpic,
  getIdea,
  getJpdItem,
  getPlan,
  healthCheck,
  linkDependency,
  listAssetObjectTypeAttributes,
  listAssetObjectTypes,
  listAssetSchemas,
  listJpdIssueTypes,
  listPlans,
  linkIdeaEpic,
  plansHealthCheck,
  searchAssetObjects,
  searchEpics,
  searchIdeas,
  searchJpdItems,
  searchPortfolioItems,
  searchSpaces,
  setIdeaLinks,
  setJpdConnection,
  setPortfolioFields,
  updateAssetObject,
  updateEpic,
  updateIdea,
  updatePlan,
} from "./service.js";

function asToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload as Record<string, unknown>,
  };
}

const server = new McpServer({
  name: "jira-portfolio-mcp",
  version: "0.1.0",
});

server.tool("health_check", "Validate Jira REST access and schema discovery.", {}, async () =>
  asToolResult(await healthCheck()),
);

server.tool("assets_health_check", "Validate Jira Assets workspace access and list visible schemas.", {}, async () =>
  asToolResult(await assetsHealthCheck()),
);

server.tool(
  "discover_jira_schema",
  "Discover JPD/Jira Software schema and persist the tenant bootstrap config.",
  {},
  async () => asToolResult(await discoverJiraSchema()),
);

server.tool(
  "discover_premium_capabilities",
  "Discover Jira Product Discovery Premium, Jira Plans, and Advanced Roadmaps capabilities.",
  {},
  async () => asToolResult(await discoverPremiumCapabilities()),
);

server.tool(
  "search_spaces",
  "List Jira Product Discovery spaces discovered in the tenant.",
  {
    searchString: z.string().optional(),
  },
  async (input) => asToolResult(await searchSpaces(input)),
);

server.tool(
  "list_jpd_issue_types",
  "List all issue types exposed by Jira Product Discovery spaces, not only Idea.",
  {
    projectKey: z.string().optional(),
  },
  async (input) => asToolResult(await listJpdIssueTypes(input)),
);

server.tool(
  "search_jpd_items",
  "Search generic Jira Product Discovery work items across configured JPD issue types.",
  {
    projectKeys: z.array(z.string()).optional(),
    issueTypeNames: z.array(z.string()).optional(),
    issueTypeIds: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    searchText: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    nextPageToken: z.string().optional(),
  },
  async (input) => asToolResult(await searchJpdItems(input)),
);

server.tool(
  "get_jpd_item",
  "Get any Jira Product Discovery item by issue key or id.",
  {
    issueKey: z.string().optional(),
    issueId: z.string().optional(),
  },
  async (input) => asToolResult(await getJpdItem(input)),
);

server.tool(
  "discover_jpd_connections",
  "Discover connection-like JPD fields visible through field catalog and edit metadata.",
  {
    projectKey: z.string().optional(),
  },
  async (input) => asToolResult(await discoverJpdConnections(input)),
);

server.tool(
  "set_jpd_connection",
  "Set or append a JPD connection field after validating issue edit metadata.",
  {
    issueKey: z.string().min(1),
    connectionFieldId: z.string().optional(),
    connectionFieldName: z.string().optional(),
    targetIssueKeys: z.array(z.string()).min(1),
    replace: z.boolean().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await setJpdConnection(input)),
);

server.tool(
  "list_asset_schemas",
  "List Jira Assets object schemas visible to the current user.",
  {
    maxResults: z.number().int().min(1).max(100).optional(),
    includeCounts: z.boolean().optional(),
  },
  async (input) => asToolResult(await listAssetSchemas(input)),
);

server.tool(
  "list_asset_object_types",
  "List object types for an Assets schema.",
  {
    objectSchemaId: z.string().min(1),
    flat: z.boolean().optional(),
  },
  async (input) => asToolResult(await listAssetObjectTypes(input)),
);

server.tool(
  "get_asset_object_type",
  "Get an Assets object type by id.",
  {
    objectTypeId: z.string().min(1),
  },
  async (input) => asToolResult(await getAssetObjectType(input)),
);

server.tool(
  "list_asset_object_type_attributes",
  "List attributes for an Assets object type.",
  {
    objectTypeId: z.string().min(1),
    onlyValueEditable: z.boolean().optional(),
    includeChildren: z.boolean().optional(),
  },
  async (input) => asToolResult(await listAssetObjectTypeAttributes(input)),
);

server.tool(
  "search_asset_objects",
  "Search Jira Assets objects using Assets Query Language (AQL).",
  {
    aql: z.string().min(1),
    startAt: z.number().int().min(0).optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
    includeAttributes: z.boolean().optional(),
  },
  async (input) => asToolResult(await searchAssetObjects(input)),
);

server.tool(
  "get_asset_object",
  "Get a Jira Assets object by object id.",
  {
    objectId: z.string().min(1),
  },
  async (input) => asToolResult(await getAssetObject(input)),
);

server.tool(
  "get_asset_object_attributes",
  "Get attributes for a Jira Assets object.",
  {
    objectId: z.string().min(1),
  },
  async (input) => asToolResult(await getAssetObjectAttributes(input)),
);

const assetAttributeInputSchema = z.object({
  objectTypeAttributeId: z.string().optional(),
  attributeName: z.string().optional(),
  name: z.string().optional(),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  objectAttributeValues: z.array(z.record(z.string(), z.unknown())).optional(),
});

server.tool(
  "create_asset_object",
  "Create a Jira Assets object. In apply mode the label must use the MCPTEST:: pilot prefix.",
  {
    objectTypeId: z.string().min(1),
    label: z.string().optional(),
    attributes: z.array(assetAttributeInputSchema).min(1),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createAssetObject(input)),
);

server.tool(
  "update_asset_object",
  "Update editable attributes on a Jira Assets object. Apply mode is restricted to pilot objects.",
  {
    objectId: z.string().min(1),
    objectTypeId: z.string().optional(),
    attributes: z.array(assetAttributeInputSchema).min(1),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await updateAssetObject(input)),
);

server.tool(
  "delete_asset_object",
  "Delete a Jira Assets object. Apply mode is restricted to pilot objects.",
  {
    objectId: z.string().min(1),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await deleteAssetObject(input)),
);

server.tool(
  "search_ideas",
  "Search JPD ideas through Jira JQL.",
  {
    projectKeys: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    horizon: z.string().optional(),
    linkedGoalId: z.string().optional(),
    atlassianProjectId: z.string().optional(),
    searchText: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    nextPageToken: z.string().optional(),
  },
  async (input) => asToolResult(await searchIdeas(input)),
);

server.tool(
  "get_idea",
  "Get a JPD idea by issue key or id.",
  {
    issueKey: z.string().optional(),
    issueId: z.string().optional(),
  },
  async (input) => asToolResult(await getIdea(input)),
);

server.tool(
  "create_idea",
  "Create a JPD idea in a discovered Product Discovery space.",
  {
    projectKey: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().optional(),
    horizon: z.string().optional(),
    desiredOutcome: z.string().optional(),
    hypothesis: z.string().optional(),
    businessOwnerId: z.string().optional(),
    techOwnerId: z.string().optional(),
    adoptionOwnerId: z.string().optional(),
    primaryBusinessGoalId: z.string().optional(),
    adoptionGoalId: z.string().optional(),
    atlassianProjectId: z.string().optional(),
    status: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createIdea(input)),
);

server.tool(
  "update_idea",
  "Update JPD idea fields and optionally transition status.",
  {
    issueKey: z.string().optional(),
    issueId: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    horizon: z.string().optional(),
    desiredOutcome: z.string().optional(),
    hypothesis: z.string().optional(),
    businessOwnerId: z.string().optional(),
    techOwnerId: z.string().optional(),
    adoptionOwnerId: z.string().optional(),
    status: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await updateIdea(input)),
);

server.tool(
  "set_idea_links",
  "Set the primary business goal, optional adoption goal, and Atlassian Project on an idea.",
  {
    issueKey: z.string().optional(),
    issueId: z.string().optional(),
    primaryBusinessGoalId: z.string().min(1),
    adoptionGoalId: z.string().optional(),
    atlassianProjectId: z.string().min(1),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await setIdeaLinks(input)),
);

server.tool(
  "search_epics",
  "Search Jira epics through Jira JQL.",
  {
    projectKeys: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    searchText: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    nextPageToken: z.string().optional(),
  },
  async (input) => asToolResult(await searchEpics(input)),
);

server.tool(
  "get_epic",
  "Get a Jira Epic by issue key or id.",
  {
    issueKey: z.string().optional(),
    issueId: z.string().optional(),
  },
  async (input) => asToolResult(await getEpic(input)),
);

server.tool(
  "create_epic",
  "Create a Jira Epic and optionally set Goals / Primary JPD Idea Key metadata.",
  {
    projectKey: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().optional(),
    goalIds: z.array(z.string()).optional(),
    primaryJpdIdeaKey: z.string().optional(),
    status: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createEpic(input)),
);

server.tool(
  "update_epic",
  "Update a Jira Epic and optionally transition status.",
  {
    issueKey: z.string().optional(),
    issueId: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    goalIds: z.array(z.string()).optional(),
    primaryJpdIdeaKey: z.string().optional(),
    status: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await updateEpic(input)),
);

server.tool(
  "link_idea_epic",
  "Link a JPD idea to a Jira Epic using a Jira issue link plus the optional helper field.",
  {
    ideaKey: z.string().min(1),
    epicKey: z.string().min(1),
    primaryJpdIdeaKey: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await linkIdeaEpic(input)),
);

server.tool("plans_health_check", "Validate Jira Plans API access for the current token.", {}, async () =>
  asToolResult(await plansHealthCheck()),
);

server.tool(
  "list_plans",
  "List Jira Plans when the current user has Jira Plans API access.",
  {
    includeArchived: z.boolean().optional(),
    includeTrashed: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  },
  async (input) => asToolResult(await listPlans(input)),
);

server.tool(
  "get_plan",
  "Get one Jira Plan by id when the current user has Jira Plans API access.",
  {
    planId: z.union([z.string(), z.number()]),
  },
  async (input) => asToolResult(await getPlan(input)),
);

const planIssueSourceSchema = z.object({
  type: z.enum(["Project", "Board", "Filter"]),
  value: z.union([z.string(), z.number()]),
});

server.tool(
  "create_plan",
  "Create a Jira Plan in guarded mode. Atlassian requires Administer Jira permission.",
  {
    name: z.string().min(1),
    issueSources: z.array(planIssueSourceSchema).min(1),
    scheduling: z.record(z.string(), z.unknown()).optional(),
    leadAccountId: z.string().optional(),
    permissions: z.array(z.record(z.string(), z.unknown())).optional(),
    customFields: z.array(z.record(z.string(), z.unknown())).optional(),
    exclusionRules: z.record(z.string(), z.unknown()).optional(),
    crossProjectReleases: z.array(z.record(z.string(), z.unknown())).optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createPlan(input)),
);

server.tool(
  "update_plan",
  "Patch a Jira Plan in guarded mode. Atlassian requires Administer Jira permission.",
  {
    planId: z.union([z.string(), z.number()]),
    patch: z.array(z.record(z.string(), z.unknown())).min(1),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await updatePlan(input)),
);

server.tool(
  "search_portfolio_items",
  "Search Jira Software issues by Advanced Roadmaps / Jira Premium fields.",
  {
    projectKeys: z.array(z.string()).optional(),
    issueTypes: z.array(z.string()).optional(),
    parentLink: z.string().optional(),
    team: z.string().optional(),
    targetStartFrom: z.string().optional(),
    targetEndTo: z.string().optional(),
    statuses: z.array(z.string()).optional(),
    searchText: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
    nextPageToken: z.string().optional(),
  },
  async (input) => asToolResult(await searchPortfolioItems(input)),
);

server.tool(
  "set_portfolio_fields",
  "Set Advanced Roadmaps / Jira Premium fields on a Jira issue after editmeta validation.",
  {
    issueKey: z.string().min(1),
    parentLinkKey: z.string().optional(),
    teamIdOrName: z.string().optional(),
    targetStart: z.string().optional(),
    targetEnd: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await setPortfolioFields(input)),
);

server.tool(
  "link_dependency",
  "Create a deduplicated Jira dependency link, defaulting to the Blocks link type.",
  {
    blocksIssueKey: z.string().min(1),
    blockedIssueKey: z.string().min(1),
    linkType: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await linkDependency(input)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
