export type SessionState = {
  serverReady: boolean;
  signedIn: boolean;
  workspaceId: string | null;
};

export type SessionLoaders = {
  loadServer: () => Promise<unknown>;
  loadToken: () => Promise<unknown>;
  loadWorkspaceId: () => Promise<unknown>;
  getServer: () => unknown;
  getToken: () => string | null;
  getWorkspaceId: () => string | null;
};

export async function loadSessionState(loaders: SessionLoaders): Promise<SessionState> {
  await Promise.all([loaders.loadServer(), loaders.loadToken(), loaders.loadWorkspaceId()]);
  return {
    serverReady: Boolean(loaders.getServer()),
    signedIn: Boolean(loaders.getServer() && loaders.getToken()),
    workspaceId: loaders.getWorkspaceId(),
  };
}
