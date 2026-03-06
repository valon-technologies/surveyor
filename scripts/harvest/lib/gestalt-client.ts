const GESTALT_BASE = "https://api.gestalt.peachstreet.dev/api/v1";

function getApiKey(): string {
  const key = process.env.GESTALT_API_KEY;
  if (!key) throw new Error("GESTALT_API_KEY not set");
  return key;
}

export async function gestaltGet<T = unknown>(
  integration: string,
  operation: string,
  params: Record<string, string> = {},
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = `${GESTALT_BASE}/${integration}/${operation}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gestalt ${integration}/${operation} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.status === "error") throw new Error(`Gestalt error: ${json.error?.message}`);
  return json.data as T;
}

export async function linearGql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = JSON.stringify(variables);

  const res = await fetch(`${GESTALT_BASE}/linear/gql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gestalt Linear GQL failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}
