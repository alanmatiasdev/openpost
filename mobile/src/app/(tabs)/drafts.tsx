import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BodyText, Button, Card, Screen, TextField, useColors } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";
import { usePublications, useWorkspaces, type PublicationListItem } from "@/lib/queries";
import { getServer } from "@/lib/server";
import { signOut } from "@/lib/auth";

export default function DraftsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [idea, setIdea] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const drafts = usePublications("draft");
  const workspaces = useWorkspaces();
  const [menuOpen, setMenuOpen] = useState(false);

  const createDraft = useMutation({
    mutationFn: async (text: string) => {
      const workspaceId = workspaces.data?.[0]?.id;
      if (!workspaceId) throw new Error("No workspace");
      const { data, error, response } = await api().POST("/publications", {
        body: {
          workspace_id: workspaceId,
          creation_preset: "post",
          content_profile: "short_text",
          title: "",
          source_text: text,
        },
      });
      if (error || !data) throw new Error(await errorMessage(response, "Could not save draft"));
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["publications"] });
    },
  });

  async function quickCapture() {
    const text = idea.trim();
    setCaptureError(null);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const draft = await new Promise<
        NonNullable<Awaited<ReturnType<typeof createDraft.mutateAsync>>>
      >((resolve, reject) => createDraft.mutate(text, { onSuccess: resolve, onError: reject }));
      setIdea("");
      router.push(`/compose/${draft.id}` as never);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : "Could not save draft");
    }
  }

  const list = drafts.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Drafts</Text>
          {workspaces.data && workspaces.data.length > 1 ? (
            <Pressable onPress={() => setMenuOpen(true)}>
              <BodyText>{workspaces.data.find(() => true)?.name ?? ""} ▾</BodyText>
            </Pressable>
          ) : null}
        </View>
        <MenuButton colors={colors.text} onOpen={() => setMenuOpen(true)} />
        <Button
          title="＋ New"
          variant="tinted"
          onPress={() => void quickCapture()}
          disabled={createDraft.isPending}
        />
      </View>

      <View style={styles.capture}>
        <TextField
          value={idea}
          onChangeText={setIdea}
          placeholder="Jot an idea…"
          multiline
          onSubmitEditing={() => void quickCapture()}
        />
        {captureError ? (
          <BodyText style={{ color: colors.danger, marginTop: 6 }}>{captureError}</BodyText>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={drafts.isRefetching}
            onRefresh={() => void drafts.refetch()}
            tintColor={colors.textSecondary}
          />
        }
      >
        {drafts.isLoading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.tint} />
        ) : null}
        {list.length === 0 && !drafts.isLoading ? (
          <Card style={styles.empty}>
            <BodyText style={{ textAlign: "center" }}>
              No drafts yet. Capture an idea above — it saves instantly and you can polish it later.
            </BodyText>
          </Card>
        ) : null}
        {list.map((draft) => (
          <DraftRow key={draft.id} draft={draft} />
        ))}
      </ScrollView>

      {menuOpen ? (
        <WorkspaceMenu onClose={() => setMenuOpen(false)} workspaces={workspaces.data ?? []} />
      ) : null}
    </Screen>
  );
}

function MenuButton({ colors, onOpen }: { colors: string; onOpen: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} hitSlop={8}>
      <Text style={{ color: colors, fontSize: 20, paddingHorizontal: 6 }}>⌄</Text>
    </Pressable>
  );
}

function DraftRow({ draft }: { draft: PublicationListItem }) {
  const colors = useColors();
  const excerpt = firstRenditionBody(draft) ?? draft.title ?? "Untitled draft";
  return (
    <Pressable onPress={() => router.push(`/compose/${draft.id}` as never)}>
      {({ pressed }) => (
        <Card style={[styles.row, pressed && { opacity: 0.6 }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
              {excerpt}
            </Text>
            <BodyText>Edited {relativeTime(draft.updated_at)}</BodyText>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function firstRenditionBody(draft: PublicationListItem): string | null {
  for (const rendition of draft.renditions ?? []) {
    if (rendition.body) return rendition.body;
  }
  return null;
}

function WorkspaceMenu({
  onClose,
  workspaces,
}: {
  onClose: () => void;
  workspaces: { id: string; name?: string | null }[];
}) {
  const colors = useColors();
  const server = getServer();
  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      <Card style={[styles.menu, { backgroundColor: colors.card }]}>
        {workspaces.map((workspace) => (
          <Pressable
            key={workspace.id}
            onPress={() => {
              onClose();
              router.push("/onboarding/workspace");
            }}
            style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
          >
            <Text style={{ color: colors.text, fontSize: 16 }}>Switch workspace</Text>
            <BodyText>All workspaces</BodyText>
          </Pressable>
        ))}
        {server ? (
          <Pressable
            onPress={() => {
              onClose();
              void import("react-native").then(({ Linking }) => Linking.openURL(server.baseUrl));
            }}
            style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
          >
            <Text style={{ color: colors.tint, fontSize: 16 }}>Open web app</Text>
            <BodyText>Full settings live here</BodyText>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            onClose();
            void signOut().then(() => router.replace("/"));
          }}
          style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
        >
          <Text style={{ color: colors.danger, fontSize: 16 }}>Sign out</Text>
        </Pressable>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  capture: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  list: {
    padding: 20,
    gap: 10,
  },
  empty: {
    marginTop: 16,
  },
  row: {
    paddingVertical: 14,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: 16,
    paddingTop: 70,
  },
  menu: {
    width: 240,
    paddingVertical: 4,
  },
  menuRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    gap: 2,
  },
});
