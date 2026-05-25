import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createGoal,
  createGoalUpdate,
  createProject,
  createProjectUpdate,
  discoverTenantModel,
  getGoal,
  getProject,
  healthCheck,
  linkGoalProject,
  linkGoalWorkItem,
  listGoalTypes,
  searchGoals,
  searchProjects,
  updateGoal,
  updateProject,
  upsertSuccessMeasures,
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
  name: "goals-projects-mcp",
  version: "0.1.0",
});

server.tool("health_check", "Validate GraphQL access to Atlassian Goals and Projects.", {}, async () =>
  asToolResult(await healthCheck()),
);

server.tool(
  "discover_tenant_model",
  "Discover goal types and write tenant bootstrap config.",
  {},
  async () => asToolResult(await discoverTenantModel()),
);

server.tool("list_goal_types", "List native and logical goal type mappings.", {}, async () =>
  asToolResult(await listGoalTypes()),
);

server.tool(
  "search_goals",
  "Search Atlassian Goals by free text.",
  {
    searchString: z.string().optional(),
    first: z.number().int().min(1).max(50).optional(),
    after: z.string().optional(),
  },
  async (input) => asToolResult(await searchGoals(input)),
);

server.tool(
  "get_goal",
  "Get a goal by id or key.",
  {
    goalId: z.string().optional(),
    goalKey: z.string().optional(),
  },
  async (input) => asToolResult(await getGoal(input)),
);

server.tool(
  "create_goal",
  "Create a goal with canonical parent and logical goal typing metadata.",
  {
    name: z.string().min(1),
    goalType: z.enum(["ORG", "BUSINESS", "ADOPTION", "SUCCESS_MEASURE"]),
    goalTypeId: z.string().optional(),
    canonicalParentGoalId: z.string().optional(),
    secondaryContributionRefs: z.array(z.string()).optional(),
    ownerId: z.string().optional(),
    targetDate: z
      .object({
        date: z.string().optional(),
        confidence: z.enum(["DAY", "MONTH", "QUARTER"]).optional(),
      })
      .optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    accessLevel: z.enum(["OPEN_EDIT", "OPEN_VIEW", "RESTRICTED"]).optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createGoal(input)),
);

server.tool(
  "update_goal",
  "Update a goal and refresh MCP metadata.",
  {
    goalId: z.string().optional(),
    goalKey: z.string().optional(),
    name: z.string().optional(),
    ownerId: z.string().optional(),
    targetDate: z
      .object({
        date: z.string().optional(),
        confidence: z.enum(["DAY", "MONTH", "QUARTER"]).optional(),
      })
      .optional(),
    description: z.string().optional(),
    secondaryContributionRefs: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    logicalGoalType: z.enum(["ORG", "BUSINESS", "ADOPTION", "SUCCESS_MEASURE"]).optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await updateGoal(input)),
);

server.tool(
  "upsert_success_measures",
  "Create or update metric targets on a goal.",
  {
    goalId: z.string().optional(),
    goalKey: z.string().optional(),
    measures: z.array(
      z.object({
        name: z.string().min(1),
        type: z.enum(["CURRENCY", "NUMERIC", "PERCENTAGE"]),
        startValue: z.number(),
        targetValue: z.number(),
        currentValue: z.number().optional(),
      }),
    ),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await upsertSuccessMeasures(input)),
);

server.tool(
  "create_goal_update",
  "Create a progress update on a goal.",
  {
    goalId: z.string().optional(),
    goalKey: z.string().optional(),
    status: z.string().optional(),
    score: z.number().int().optional(),
    summary: z.string().optional(),
    targetDate: z
      .object({
        date: z.string().optional(),
        confidence: z.enum(["DAY", "MONTH", "QUARTER"]).optional(),
      })
      .optional(),
    notes: z
      .array(
        z.object({
          summary: z.string().optional(),
          description: z.string().min(1),
        }),
      )
      .optional(),
    highlights: z
      .array(
        z.object({
          summary: z.string().min(1),
          description: z.string().min(1),
          type: z.enum(["LEARNING", "RISK", "DECISION"]),
        }),
      )
      .optional(),
    metricUpdates: z
      .array(
        z.object({
          metricTargetId: z.string().min(1),
          newValue: z.number(),
        }),
      )
      .optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createGoalUpdate(input)),
);

server.tool(
  "search_projects",
  "Search Atlassian Projects by free text.",
  {
    searchString: z.string().optional(),
    first: z.number().int().min(1).max(50).optional(),
    after: z.string().optional(),
  },
  async (input) => asToolResult(await searchProjects(input)),
);

server.tool(
  "get_project",
  "Get a project by id or key.",
  {
    projectId: z.string().optional(),
    projectKey: z.string().optional(),
  },
  async (input) => asToolResult(await getProject(input)),
);

server.tool(
  "create_project",
  "Create an Atlassian Project aggregate and link it to business goals.",
  {
    name: z.string().min(1),
    ownerId: z.string().optional(),
    targetDate: z
      .object({
        date: z.string().optional(),
        confidence: z.enum(["DAY", "MONTH", "QUARTER"]).optional(),
      })
      .optional(),
    description: z.string().optional(),
    synergyThesis: z.string().optional(),
    measurement: z.string().optional(),
    primaryBusinessGoalId: z.string().optional(),
    secondaryGoalIds: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createProject(input)),
);

server.tool(
  "update_project",
  "Update project metadata and optionally create a status update.",
  {
    projectId: z.string().optional(),
    projectKey: z.string().optional(),
    name: z.string().optional(),
    ownerId: z.string().optional(),
    description: z.string().optional(),
    synergyThesis: z.string().optional(),
    measurement: z.string().optional(),
    targetDate: z
      .object({
        date: z.string().optional(),
        confidence: z.enum(["DAY", "MONTH", "QUARTER"]).optional(),
      })
      .optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    notes: z
      .array(
        z.object({
          summary: z.string().optional(),
          description: z.string().min(1),
        }),
      )
      .optional(),
    secondaryGoalIds: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await updateProject(input)),
);

server.tool(
  "create_project_update",
  "Create a status update on an Atlassian Project.",
  {
    projectId: z.string().optional(),
    projectKey: z.string().optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    targetDate: z
      .object({
        date: z.string().optional(),
        confidence: z.enum(["DAY", "MONTH", "QUARTER"]).optional(),
      })
      .optional(),
    notes: z
      .array(
        z.object({
          summary: z.string().optional(),
          description: z.string().min(1),
        }),
      )
      .optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await createProjectUpdate(input)),
);

server.tool(
  "link_goal_project",
  "Link an Atlassian Goal to an Atlassian Project.",
  {
    goalId: z.string().optional(),
    goalKey: z.string().optional(),
    projectId: z.string().optional(),
    projectKey: z.string().optional(),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await linkGoalProject(input)),
);

server.tool(
  "link_goal_work_item",
  "Link an Atlassian Goal to a Jira work item using a GraphQL work item id.",
  {
    goalId: z.string().optional(),
    goalKey: z.string().optional(),
    workItemId: z.string().min(1),
    mode: z.enum(["preview", "apply"]).optional(),
    idempotencyKey: z.string().optional(),
    changeReason: z.string().optional(),
  },
  async (input) => asToolResult(await linkGoalWorkItem(input)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
