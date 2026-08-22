import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useShareIntentContext } from "expo-share-intent";

import { BodyText, Button, Card, IconButton, Screen, TextField, useColors } from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { relativeTime } from "@/lib/format";
import { stashSharedFiles } from "@/lib/share";
import {
  currentWorkspaceId,
  usePublications,
  useWorkspaces,
  type PublicationListItem,
} from "@/lib/queries";
import { getWorkspaceId } from "@/lib/api/token-store";
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
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const handledShare = useRef(false);

  const createDraft = useMutation({
    mutationFn: async (text: string) => {
      const { data, error, response } = await api().POST("/publications", {
        body: {
          workspace_id: currentWorkspaceId(),
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
      const draft = await createDraft.mutateAsync(text);
      setIdea("");
      router.push({ pathname: "/compose/[id]", params: { id: draft.id } });
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : "Could not save draft");
    }
  }

  useEffect(() => {
    if (!hasShareIntent || handledShare.current) return;
    if (!workspaces.data?.[0]?.id) return;
    handledShare.current = true;

    const parts = [shareIntent.text?.trim(), shareIntent.webUrl?.trim()].filter(Boolean);
    const sharedText = parts.join("\n\n");
    const files = shareIntent.files ?? [];
    if (files.length > 0) stashSharedFiles(files);

    resetShareIntent();
    void (async () => {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const draft = await createDraft.mutateAsync(sharedText);
        router.push({ pathname: "/compose/[id]", params: { id: draft.id } });
      } catch {
        setCaptureError("Could not create a draft from the shared content");
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, workspaces.data, createDraft]);

  const list = drafts.data ?? [];
  const activeWorkspace = workspaces.data?.find((workspace) => workspace.id === getWorkspaceId());

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Drafts</Text>
          {workspaces.data && workspaces.data.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch workspace"
              onPress={() => setMenuOpen(true)}
            >
              <BodyText>{activeWorkspace?.name ?? "Choose workspace"}</BodyText>
            </Pressable>
          ) : null}
        </View>
        <MenuButton onOpen={() => setMenuOpen(true)} />
        <Button
          title="New draft"
          variant="tinted"
          onPress={() => void quickCapture()}
          disabled={createDraft.isPending}
        />
      </View>

      <View style={styles.capture}>
        <TextField
          value={idea}
          onChangeText={setIdea}
          accessibilityLabel="Draft idea"
          placeholder="Jot an idea"
          multiline
          onSubmitEditing={() => void quickCapture()}
        />
        {captureError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.danger, marginTop: 6 }}>
            {captureError}
          </BodyText>
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
              No drafts yet. Capture an idea above. It saves at once and opens in the composer.
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

function MenuButton({ onOpen }: { onOpen: () => void }) {
  return (
    <IconButton
      label="Open workspace menu"
      name={{ ios: "ellipsis", android: "more_vert" }}
      onPress={onOpen}
    />
  );
}

function DraftRow({ draft }: { draft: PublicationListItem }) {
  const colors = useColors();
  const excerpt = firstRenditionBody(draft) ?? draft.title ?? "Untitled draft";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${excerpt}. Edited ${relativeTime(draft.updated_at)}`}
      onPress={() => router.push({ pathname: "/compose/[id]", params: { id: draft.id } })}
    >
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
  const activeWorkspace = workspaces.find((workspace) => workspace.id === getWorkspaceId());
  return (
    <Modal animationType="fade" transparent onRequestClose={onClose}>
      <Pressable accessible={false} style={styles.overlay} onPress={onClose}>
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          onPress={(event) => event.stopPropagation()}
        >
          <Card style={[styles.menu, { backgroundColor: colors.card }]}>
            {workspaces.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  router.push("/onboarding/workspace");
                }}
                style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
              >
                <Text style={{ color: colors.text, fontSize: 16 }}>Switch workspace</Text>
                <BodyText>{activeWorkspace?.name ?? "Choose another workspace"}</BodyText>
              </Pressable>
            ) : null}
            {server ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  onClose();
                  void Linking.openURL(server.baseUrl);
                }}
                style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.5 }]}
              >
                <Text style={{ color: colors.tint, fontSize: 16 }}>Open web app</Text>
                <BodyText>Manage accounts and settings</BodyText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
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
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
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
    paddingTop: 16,
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
