import { JiraRestClient } from "./jira-rest.js";

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export async function resolveAccountId(
  identifier: string,
  jiraClient: JiraRestClient,
): Promise<string> {
  if (identifier.includes("@")) {
    const query = encodeURIComponent(identifier);
    const response = await jiraClient.get<JiraUser[]>(
      `/rest/api/3/user/search?query=${query}&maxResults=1`,
    );
    const match = response[0];
    if (!match) {
      throw new Error(`No Jira user found for "${identifier}".`);
    }
    return match.accountId;
  }

  return identifier;
}
