import * as SecureStore from "expo-secure-store";

const KEY = "openpost.auth.token";
const WORKSPACE_KEY = "openpost.workspace.id";

let token: string | null = null;
let workspaceId: string | null = null;
const tokenListeners = new Set<() => void>();
const workspaceListeners = new Set<() => void>();

export function getToken(): string | null {
  return token;
}

export function subscribeToken(listener: () => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

function notifyToken() {
  for (const listener of tokenListeners) listener();
}

export function subscribeWorkspaceId(listener: () => void): () => void {
  workspaceListeners.add(listener);
  return () => workspaceListeners.delete(listener);
}

function notifyWorkspaceId() {
  for (const listener of workspaceListeners) listener();
}

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(KEY);
  return token;
}

export async function saveToken(value: string): Promise<void> {
  token = value;
  workspaceId = null;
  await SecureStore.setItemAsync(KEY, value);
  await SecureStore.deleteItemAsync(WORKSPACE_KEY);
  notifyToken();
  notifyWorkspaceId();
}

export async function clearToken(): Promise<void> {
  token = null;
  workspaceId = null;
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(WORKSPACE_KEY);
  notifyToken();
  notifyWorkspaceId();
}

export async function loadWorkspaceId(): Promise<string | null> {
  workspaceId = await SecureStore.getItemAsync(WORKSPACE_KEY);
  notifyWorkspaceId();
  return workspaceId;
}

export async function saveWorkspaceId(value: string): Promise<void> {
  workspaceId = value;
  await SecureStore.setItemAsync(WORKSPACE_KEY, value);
  notifyWorkspaceId();
}

export function getWorkspaceId(): string | null {
  return workspaceId;
}
