import createClient from "openapi-fetch";

import type { paths } from "./schema";
import { getServer, subscribeServer } from "../server";
import { getToken, subscribeToken } from "./token-store";

export type Api = ReturnType<typeof createClient<paths>>;

let client: Api | null = null;
let clientKey = "";

function rebuild() {
  const server = getServer();
  const token = getToken();
  const key = `${server?.baseUrl ?? ""}|${token ?? ""}`;
  if (client && key === clientKey) return client;
  clientKey = key;
  client = createClient<paths>({
    baseUrl: server ? `${server.baseUrl}/api/v1` : "",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return client;
}

subscribeServer(rebuild);
subscribeToken(rebuild);

/** Typed API client bound to the current server + bearer token. */
export function api(): Api {
  return rebuild();
}

export function apiUrl(path: string): string {
  const server = getServer();
  if (!server) throw new Error("No server configured");
  return `${server.baseUrl}${path}`;
}

/** Extract a readable message from an openapi-fetch error response. */
export async function errorMessage(
  response: Response | undefined,
  fallback: string,
): Promise<string> {
  if (!response) return fallback;
  try {
    const body = (await response.json()) as { message?: string; title?: string };
    return body.message ?? body.title ?? fallback;
  } catch {
    return `${fallback} (${response.status})`;
  }
}
