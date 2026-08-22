import { useQuery } from "@tanstack/react-query";

import { api, errorMessage } from "./api/client";
import { getWorkspaceId } from "./api/token-store";

export type WorkspaceSummary = {
  id: string;
  name?: string | null;
};

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error, response } = await api().GET("/workspaces");
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not load workspaces"));
      return (data ?? []).filter((w) => Boolean(w)).map((w) => ({ id: w.id, name: w.name }));
    },
  });
}

export function currentWorkspaceId(): string {
  const id = getWorkspaceId();
  if (!id) throw new Error("No workspace selected");
  return id;
}

export type PublicationListItem = {
  id: string;
  title?: string | null;
  status: string;
  scheduled_at?: string | null;
  actual_run_at?: string | null;
  updated_at?: string | null;
  renditions?:
    | {
        id?: string;
        social_account_id?: string;
        platform?: string;
        status?: string;
        body?: string;
        error_message?: string | null;
        external_url?: string | null;
      }[]
    | null;
};

export function usePublications(
  bucket: "draft" | "scheduled" | "published" | "failed",
  extra?: { calendar_from?: string; calendar_before?: string },
) {
  return useQuery({
    queryKey: ["publications", bucket, extra ?? {}],
    queryFn: async () => {
      const { data, error, response } = await api().GET("/publications", {
        params: {
          query: {
            workspace_id: currentWorkspaceId(),
            activity_bucket: bucket,
            limit: 100,
            ...extra,
          },
        },
      });
      if (error || !data) throw new Error(await errorMessage(response, "Could not load posts"));
      return (data ?? []) as PublicationListItem[];
    },
  });
}

export type AccountSummary = {
  id: string;
  platform: string;
  slug?: string | null;
  account_username?: string | null;
  is_active: boolean;
};

export function useAccounts(enabled = true) {
  return useQuery({
    queryKey: ["accounts"],
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api().GET("/accounts", {
        params: { query: { workspace_id: currentWorkspaceId() } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "Could not load accounts"));
      return (data ?? [])
        .filter((a) => Boolean(a && a.is_active))
        .map((a) => ({
          id: a.id,
          platform: a.platform,
          slug: a.slug,
          account_username: a.account_username,
          is_active: true,
        }));
    },
  });
}

export type SocialSetSummary = {
  id: string;
  name?: string | null;
  is_default?: boolean | null;
  accounts?: { social_account_id: string }[] | null;
};

export function useSocialSets(enabled = true) {
  return useQuery({
    queryKey: ["social-sets"],
    enabled,
    queryFn: async () => {
      const { data, error, response } = await api().GET("/social-sets", {
        params: { query: { workspace_id: currentWorkspaceId() } },
      });
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not load social sets"));
      return (data ?? [])
        .filter((s) => Boolean(s))
        .map((s) => ({ id: s.id, name: s.name, is_default: s.is_default, accounts: s.accounts }));
    },
  });
}
