import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";
import { useEffect, useState, useSyncExternalStore } from "react";

import { getServer, loadServer, subscribeServer } from "@/lib/server";
import { getToken, loadToken, subscribeToken } from "@/lib/api/token-store";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function useSessionReady() {
  const [loaded, setLoaded] = useState(false);
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadServer(), loadToken()]);
      setLoaded(true);
      void SplashScreen.hideAsync();
    })();
  }, []);

  return { loaded, signedIn: Boolean(server && token) };
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const { loaded, signedIn } = useSessionReady();

  if (!loaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="onboarding/server"
            options={{ headerShown: !signedIn, title: "Server", headerBackTitle: "Back" }}
          />
          <Stack.Screen name="onboarding/login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/pair" options={{ headerShown: false }} />
          <Stack.Screen
            name="onboarding/workspace"
            options={{ headerShown: false, gestureEnabled: false }}
          />
          <Stack.Screen
            name="compose/[id]"
            options={{ presentation: "modal", title: "Compose", headerShown: false }}
          />
          <Stack.Screen name="post/[id]" options={{ title: "Post" }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
