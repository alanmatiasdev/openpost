import { Redirect } from "expo-router";
import { useSyncExternalStore } from "react";

import { getServer, subscribeServer } from "@/lib/server";
import { getToken, subscribeToken } from "@/lib/api/token-store";

export default function Gate() {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);

  if (!server) return <Redirect href="/onboarding/server" />;
  if (!token) return <Redirect href="/onboarding/login" />;
  return <Redirect href="/(tabs)/drafts" />;
}
