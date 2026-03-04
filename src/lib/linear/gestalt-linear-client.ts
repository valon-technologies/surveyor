/**
 * Fetch-based Gestalt Linear client.
 * Uses GESTALT_API_KEY env var to authenticate against the Gestalt API.
 */

const GESTALT_BASE = "https://api.gestalt.peachstreet.dev/api/v1";

function getApiKey(): string {
  const key = process.env.GESTALT_API_KEY;
  if (!key) throw new Error("GESTALT_API_KEY not set");
  return key;
}

/** Run a GraphQL query against Linear via Gestalt passthrough */
export async function linearGql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = JSON.stringify(variables);

  const res = await fetch(`${GESTALT_BASE}/linear/gql`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gestalt Linear GQL failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear GQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

/** Fetch all issues from a Linear project, handling pagination */
export async function fetchAllProjectIssues(projectId: string): Promise<LinearIssue[]> {
  const all: LinearIssue[] = [];
  let cursor: string | null = null;

  while (true) {
    const afterClause: string = cursor ? `, after: "${cursor}"` : "";
    const query: string = `{
      issues(
        filter: { project: { id: { eq: "${projectId}" } } },
        first: 250${afterClause}
      ) {
        nodes {
          id
          identifier
          title
          description
          state { name }
          labels { nodes { name } }
          parent { id identifier title }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    type IssuesResponse = {
      issues: {
        nodes: LinearIssue[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };
    const data: IssuesResponse = await linearGql<IssuesResponse>(query);

    all.push(...data.issues.nodes);

    if (!data.issues.pageInfo.hasNextPage) break;
    cursor = data.issues.pageInfo.endCursor;
  }

  return all;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
  labels: { nodes: { name: string }[] };
  parent: { id: string; identifier: string; title: string } | null;
}
