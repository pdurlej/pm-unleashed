import { z } from "zod";

const graphqlEnvSchema = z.object({
  ATLASSIAN_EMAIL: z.string().email(),
  ATLASSIAN_API_TOKEN: z.string().min(1),
  ATLASSIAN_CLOUD_ID: z.string().uuid(),
  ATLASSIAN_SITE_URL: z.string().url(),
});

const jiraEnvSchema = z.object({
  JIRA_URL: z.string().url(),
  JIRA_USERNAME: z.string().min(1),
  JIRA_API_TOKEN: z.string().min(1),
});

export type GoalsProjectsEnv = z.infer<typeof graphqlEnvSchema>;
export type JiraEnv = z.infer<typeof jiraEnvSchema>;

export function loadGoalsProjectsEnv(rawEnv: NodeJS.ProcessEnv = process.env): GoalsProjectsEnv {
  return graphqlEnvSchema.parse(rawEnv);
}

export function loadJiraEnv(rawEnv: NodeJS.ProcessEnv = process.env): JiraEnv {
  return jiraEnvSchema.parse(rawEnv);
}
