import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { BodyText, Card, Screen, SectionHeader, useColors } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { getWorkspaceId, loadWorkspaceId, saveWorkspaceId } from "@/lib/api/token-store";
import * as Haptics from "expo-haptics";

export default function WorkspaceScreen() {
  const colors = useColors();
  const [selected, setSelected] = useState<string | null>(null);

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error, response } = await api().GET("/workspaces");
      if (error || !data)
        throw new Error(await errorMessage(response, "Could not load workspaces"));
      return data.filter((w): w is NonNullable<typeof w> => Boolean(w));
    },
  });

  useEffect(() => {
    void loadWorkspaceId();
  }, []);

  const list = workspaces.data ?? [];

  useEffect(() => {
    if (list.length === 0 || selected) return;
    const stored = getWorkspaceId();
    if (stored && list.some((w) => w.id === stored)) {
      finish(stored);
    } else if (list.length === 1) {
      finish(list[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  function finish(id: string) {
    setSelected(id);
    void saveWorkspaceId(id);
    setTimeout(() => router.replace("/(tabs)/drafts"), 150);
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={[styles.title, { color: colors.text }]}>Choose workspace</Text>
      <BodyText style={styles.subtitle}>Posts and accounts live inside a workspace.</BodyText>

      {workspaces.isLoading ? <ActivityIndicator color={colors.tint} /> : null}
      {workspaces.isError ? (
        <BodyText style={{ color: colors.danger, paddingHorizontal: 20 }}>
          {workspaces.error instanceof Error ? workspaces.error.message : "Failed to load"}
        </BodyText>
      ) : null}

      {list.length > 1 ? (
        <>
          <SectionHeader label="Your workspaces" />
          <Card style={styles.list}>
            {list.map((workspace, index) => (
              <Pressable
                key={workspace.id}
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  finish(workspace.id);
                }}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.separator,
                  },
                  pressed && { opacity: 0.5 },
                ]}
              >
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                  {workspace.name}
                </Text>
                {selected === workspace.id ? <ActivityIndicator color={colors.tint} /> : null}
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 96,
  },
  subtitle: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  list: {
    paddingVertical: 4,
    marginHorizontal: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
    flexShrink: 1,
  },
});
