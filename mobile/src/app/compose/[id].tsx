import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  BodyText,
  Button,
  Card,
  Screen,
  SectionHeader,
  StatusBadge,
  TextField,
  useColors,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { formatDateTime, platformLabel } from "@/lib/format";
import { uploadAttachment, type PendingAttachment } from "@/lib/media";
import { takePendingAttachments } from "@/lib/share";
import { currentWorkspaceId, useAccounts, useSocialSets } from "@/lib/queries";

type Attachment = {
  localId: string;
  uri?: string;
  mediaId?: string;
  mimeType: string;
  filename: string;
  size: number | null;
  status: "local" | "uploading" | "ready" | "error";
};

function attachmentsFromPublication(pub: PublicationDetail): Attachment[] {
  return (pub.media ?? []).map((media) => ({
    localId: `remote-${media.id}`,
    mediaId: media.id,
    mimeType: media.mime_type ?? "image/jpeg",
    filename: media.original_filename ?? media.id,
    size: media.size ?? null,
    status: "ready" as const,
  }));
}

type PublicationDetail = NonNullable<Awaited<ReturnType<typeof fetchPublication>>>;

async function fetchPublication(id: string) {
  const { data, error, response } = await api().GET("/publications/{id}", {
    params: { path: { id } },
  });
  if (error || !data) throw new Error(await errorMessage(response, "Could not load draft"));
  return data;
}

export default function ComposeScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const publication = useQuery({
    queryKey: ["publication", id],
    queryFn: () => fetchPublication(id),
  });

  if (publication.isLoading) {
    return (
      <Screen style={{ alignItems: "center", justifyContent: "center" }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.tint} />
      </Screen>
    );
  }

  if (publication.isError || !publication.data) {
    return (
      <Screen style={{ padding: 20, paddingTop: 100, gap: 12 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <BodyText style={{ color: colors.danger }}>
          {publication.error instanceof Error ? publication.error.message : "Failed to load"}
        </BodyText>
        <Button title="Close" onPress={() => router.back()} />
      </Screen>
    );
  }

  return <Composer key={String(id)} id={id} pub={publication.data} />;
}

function Composer({ id, pub }: { id: string; pub: PublicationDetail }) {
  const colors = useColors();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(pub.title ?? "");
  const [body, setBody] = useState(
    pub.source_text ?? pub.renditions?.find((rendition) => rendition.body)?.body ?? "",
  );
  const [revision, setRevision] = useState(pub.revision ?? 0);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(
    pub.scheduled_at ? new Date(pub.scheduled_at) : null,
  );
  const [showPicker, setShowPicker] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(
    () =>
      new Set(
        (pub.renditions ?? []).map((rendition) => rendition.social_account_id).filter(Boolean),
      ),
  );
  const [renditionBodies, setRenditionBodies] = useState<Record<string, string>>(() => {
    const bodies: Record<string, string> = {};
    for (const rendition of pub.renditions ?? []) {
      if (
        rendition.social_account_id &&
        rendition.body &&
        rendition.body !== (pub.source_text ?? "")
      ) {
        bodies[rendition.social_account_id] = rendition.body;
      }
    }
    return bodies;
  });
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(() => [
    ...attachmentsFromPublication(pub),
    ...takePendingAttachments().map((pending) => ({
      localId: pending.localId,
      uri: pending.uri,
      mimeType: pending.mimeType,
      filename: pending.filename,
      size: pending.size,
      status: "local" as const,
    })),
  ]);
  const initialMediaIds = pub.media?.map((media) => media.id) ?? [];

  const accounts = useAccounts();
  const socialSets = useSocialSets();

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["publications"] });
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["publication", id] });
  }

  async function httpError(response: Response | undefined, fallback: string): Promise<Error> {
    if (response?.status === 409) {
      return new Error("This post changed elsewhere. Pulling the latest version…");
    }
    return new Error(await errorMessage(response, fallback));
  }

  /** Upload any not-yet-uploaded attachments; returns ordered media ids. */
  async function resolveAttachments(): Promise<string[]> {
    const mediaIds: string[] = [];
    for (const attachment of attachments) {
      if (attachment.mediaId) {
        mediaIds.push(attachment.mediaId);
        continue;
      }
      if (!attachment.uri || attachment.status === "error") continue;
      setAttachments((current) =>
        current.map((item) =>
          item.localId === attachment.localId ? { ...item, status: "uploading" } : item,
        ),
      );
      try {
        const mediaId = await uploadAttachment(attachment as PendingAttachment);
        mediaIds.push(mediaId);
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId
              ? { ...item, mediaId, status: "ready" as const }
              : item,
          ),
        );
      } catch (err) {
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId ? { ...item, status: "error" as const } : item,
          ),
        );
        throw err instanceof Error ? err : new Error("Could not upload photo");
      }
    }
    return mediaIds;
  }

  /** Persist title/body/schedule/selection/overrides; returns the new revision. */
  async function persist(): Promise<number> {
    // Uploads first so a failure surfaces before any post mutation.
    let mediaChanged = false;
    for (const attachment of attachments) {
      if (!attachment.mediaId || !initialMediaIds.includes(attachment.mediaId)) {
        mediaChanged = true;
        break;
      }
    }
    if (attachments.length !== initialMediaIds.length) mediaChanged = true;

    const media = await resolveAttachments();
    const desired = [...selectedAccounts];
    const removed = (pub.renditions ?? []).filter(
      (rendition) =>
        rendition.social_account_id && !selectedAccounts.has(rendition.social_account_id),
    );

    // Only touch schedule fields when the user actually changed them.
    const initialScheduled = pub.scheduled_at ? new Date(pub.scheduled_at).getTime() : 0;
    const scheduledChanged = (scheduledAt?.getTime() ?? 0) !== initialScheduled;

    const {
      data: updated,
      error,
      response,
    } = await api().PUT("/publications/{id}", {
      params: { path: { id } },
      body: {
        expected_revision: revision,
        title,
        source_text: body,
        ...(mediaChanged ? { media: media.map((mediaId) => ({ media_id: mediaId })) } : {}),
        ...(scheduledChanged
          ? scheduledAt
            ? { scheduled_at: scheduledAt.toISOString() }
            : { clear_schedule: true }
          : {}),
      },
    });
    if (error) throw await httpError(response, "Could not save");
    let nextRevision = updated?.revision ?? revision + 1;

    if (desired.length > 0) {
      const upsert = await api().PUT("/publications/{id}/renditions", {
        params: { path: { id } },
        body: {
          expected_revision: nextRevision,
          renditions: desired.map((accountId) => ({
            social_account_id: accountId,
            body: renditionBodies[accountId]?.trim() ? renditionBodies[accountId] : undefined,
          })),
        },
      });
      if (upsert.error) throw await httpError(upsert.response, "Could not update destinations");
      nextRevision = upsert.data?.revision ?? nextRevision + 1;
    }

    for (const rendition of removed) {
      if (!rendition.social_account_id) continue;
      const removal = await api().DELETE("/publications/{id}/renditions/{account_id}", {
        params: {
          path: { id, account_id: rendition.social_account_id },
          query: { confirm: true, expected_revision: nextRevision },
        },
      });
      if (!removal.error) nextRevision += 1;
    }

    setRevision(nextRevision);
    return nextRevision;
  }

  function handleError(err: Error) {
    setActionError(err.message);
    if (err.message.includes("changed elsewhere")) {
      invalidate();
    }
  }

  const saveAndClose = useMutation({
    mutationFn: persist,
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: handleError,
  });

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      if (!scheduledAt) throw new Error("Pick a time first");
      const nextRevision = await persist();
      const { error, response } = await api().POST("/publications/{id}/schedule", {
        params: { path: { id } },
        body: { expected_revision: nextRevision },
      });
      if (error) throw await httpError(response, "Could not schedule");
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatusMessage("Queued for publishing");
      invalidate();
      setTimeout(() => router.back(), 700);
    },
    onError: handleError,
  });

  const publishNow = useMutation({
    mutationFn: async () => {
      const nextRevision = await persist();
      const { error, response } = await api().POST("/publications/{id}/publish-now", {
        params: { path: { id } },
        body: { expected_revision: nextRevision },
      });
      if (error) throw await httpError(response, "Could not publish");
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
      router.back();
    },
    onError: handleError,
  });

  const deleteDraft = useMutation({
    mutationFn: async () => {
      const { error, response } = await api().DELETE("/publications/{id}", {
        params: { path: { id }, query: { confirm: true, expected_revision: revision } },
      });
      if (error) throw await httpError(response, "Could not delete");
    },
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: handleError,
  });

  const nextSlot = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api().GET("/posting-schedules/next-slot", {
        params: { query: { workspace_id: currentWorkspaceId() } },
      });
      if (error || !data) throw new Error(await errorMessage(response, "No slot found"));
      return new Date(data.slot_time);
    },
    onSuccess: (date) => {
      setScheduledAt(date);
      setShowPicker(false);
    },
    onError: handleError,
  });

  function toggleAccount(accountId: string) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAccounts((current) => {
      const next = new Set(current);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }

  function applySocialSet(accountIds: string[]) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAccounts(new Set(accountIds));
  }

  function addAttachment(asset: ImagePicker.ImagePickerAsset) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAttachments((current) => [
      ...current,
      {
        localId: `local-${Date.now()}-${current.length}`,
        uri: asset.uri,
        mimeType: asset.mimeType ?? "image/jpeg",
        filename: asset.fileName ?? `photo-${Date.now()}.jpg`,
        size: asset.fileSize ?? null,
        status: "local",
      },
    ]);
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
    });
    if (!result.canceled) {
      for (const asset of result.assets) addAttachment(asset);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setActionError("Camera permission is needed to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!result.canceled && result.assets[0]) {
      addAttachment(result.assets[0]);
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((current) => current.filter((item) => item.localId !== localId));
  }

  function moveAttachment(index: number, delta: -1 | 1) {
    setAttachments((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const isScheduled = pub.status === "scheduled" || pub.status === "publishing";

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Modal header */}
      <View style={[styles.modalHeader, { borderBottomColor: colors.separator }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: colors.tint, fontSize: 17 }}>Cancel</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusBadge status={pub.status} />
          {saveAndClose.isPending ? <ActivityIndicator size="small" color={colors.tint} /> : null}
        </View>
        <Pressable onPress={() => saveAndClose.mutate()} disabled={saveAndClose.isPending}>
          <Text
            style={{
              color: saveAndClose.isPending ? colors.textSecondary : colors.tint,
              fontSize: 17,
              fontWeight: "600",
            }}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {statusMessage ? (
          <Card>
            <BodyText style={[styles.successText, { textAlign: "center" }]}>
              {statusMessage}
            </BodyText>
          </Card>
        ) : null}
        {actionError ? <BodyText style={{ color: colors.danger }}>{actionError}</BodyText> : null}

        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          style={{ fontSize: 17, fontWeight: "600" }}
        />

        <TextField
          value={body}
          onChangeText={setBody}
          placeholder="What do you want to say?"
          multiline
          textAlignVertical="top"
          style={{ lineHeight: 22, minHeight: 140 }}
        />

        <View style={styles.attachRow}>
          {attachments.map((attachment, index) => (
            <View key={attachment.localId} style={styles.thumbWrap}>
              {attachment.uri ? (
                <Image source={{ uri: attachment.uri }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={{ fontSize: 20 }}>🖼️</Text>
                </View>
              )}
              {attachment.status === "uploading" ? (
                <View style={styles.thumbOverlay}>
                  <ActivityIndicator size="small" color="#ffffff" />
                </View>
              ) : attachment.status === "error" ? (
                <View style={[styles.thumbOverlay, { backgroundColor: "rgba(255,69,58,0.6)" }]}>
                  <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>!</Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.filename}`}
                onPress={() => removeAttachment(attachment.localId)}
                hitSlop={6}
                style={styles.thumbRemove}
              >
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✕</Text>
              </Pressable>
              {attachments.length > 1 ? (
                <>
                  {index > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Move earlier"
                      onPress={() => moveAttachment(index, -1)}
                      hitSlop={6}
                      style={[styles.thumbOrder, styles.thumbOrderLeft]}
                    >
                      <Text style={{ color: "#fff", fontSize: 10 }}>‹</Text>
                    </Pressable>
                  ) : null}
                  {index < attachments.length - 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Move later"
                      onPress={() => moveAttachment(index, 1)}
                      hitSlop={6}
                      style={[styles.thumbOrder, styles.thumbOrderRight]}
                    >
                      <Text style={{ color: "#fff", fontSize: 10 }}>›</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos from library"
            onPress={() => void pickFromLibrary()}
            style={({ pressed }) => [
              styles.addTile,
              { borderColor: colors.separator },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={{ color: colors.tint, fontSize: 24, fontWeight: "300" }}>＋</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            onPress={() => void takePhoto()}
            style={({ pressed }) => [
              styles.addTile,
              { borderColor: colors.separator },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={{ fontSize: 20 }}>📷</Text>
          </Pressable>
        </View>

        <SectionHeader label="Destinations" />
        {(socialSets.data?.length ?? 0) > 0 ? (
          <View style={styles.chipRow}>
            {[...socialSets.data!]
              .sort((a, b) => Number(b.is_default === true) - Number(a.is_default === true))
              .map((set) => (
                <Chip
                  key={set.id}
                  label={`⚙︎ ${set.name}`}
                  active={
                    (set.accounts?.length ?? 0) > 0 &&
                    (set.accounts ?? []).every((account) =>
                      selectedAccounts.has(account.social_account_id),
                    )
                  }
                  onPress={() =>
                    applySocialSet((set.accounts ?? []).map((account) => account.social_account_id))
                  }
                />
              ))}
          </View>
        ) : null}

        {accounts.isLoading ? <ActivityIndicator color={colors.tint} /> : null}
        {(accounts.data?.length ?? 0) === 0 && !accounts.isLoading ? (
          <Card>
            <BodyText>No connected accounts. Connect them in the web app first.</BodyText>
          </Card>
        ) : (
          <View style={styles.accountList}>
            {(accounts.data ?? []).map((account) => {
              const accountId = account.id;
              const selected = selectedAccounts.has(accountId);
              return (
                <View key={accountId}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggleAccount(accountId)}
                    style={({ pressed }) => [
                      styles.accountRow,
                      { backgroundColor: colors.card },
                      selected && { borderColor: colors.tint, borderWidth: 1.5 },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        selected && { backgroundColor: colors.tint, borderColor: colors.tint },
                        { borderColor: colors.separator },
                      ]}
                    >
                      {selected ? (
                        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓</Text>
                      ) : null}
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text
                        style={{ color: colors.text, fontSize: 15, fontWeight: "500" }}
                        numberOfLines={1}
                      >
                        {account.account_username ? `@${account.account_username}` : account.slug}
                      </Text>
                      <BodyText>{platformLabel(account.platform)}</BodyText>
                    </View>
                  </Pressable>
                  {selected ? (
                    <>
                      <Pressable
                        onPress={() =>
                          setExpandedAccount(expandedAccount === accountId ? null : accountId)
                        }
                        style={styles.customizeToggle}
                      >
                        <Text style={{ color: colors.tint, fontSize: 14, fontWeight: "500" }}>
                          {expandedAccount === accountId
                            ? "Hide customization"
                            : "Customize for this platform"}
                        </Text>
                      </Pressable>
                      {expandedAccount === accountId ? (
                        <TextField
                          value={renditionBodies[accountId] ?? ""}
                          onChangeText={(text) =>
                            setRenditionBodies((current) => ({ ...current, [accountId]: text }))
                          }
                          placeholder="Leave empty to use the main text…"
                          multiline
                          textAlignVertical="top"
                          style={[styles.overrideField, { minHeight: 80 }]}
                        />
                      ) : null}
                    </>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <SectionHeader label="Schedule" />
        <Card style={styles.scheduleCard}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "500" }}>
            {scheduledAt ? formatDateTime(scheduledAt.toISOString()) : "Not scheduled"}
          </Text>
          <View style={styles.scheduleActions}>
            <Button
              title={showPicker ? "Hide picker" : "Pick time"}
              variant="tinted"
              onPress={() => setShowPicker(!showPicker)}
              style={styles.scheduleButton}
            />
            <Button
              title="Next slot"
              variant="tinted"
              onPress={() => nextSlot.mutate()}
              disabled={nextSlot.isPending}
              style={styles.scheduleButton}
            />
            {scheduledAt ? (
              <Button
                title="Clear"
                variant="plain"
                onPress={() => setScheduledAt(null)}
                style={styles.scheduleButton}
              />
            ) : null}
          </View>
          {showPicker ? (
            <DateTimePicker
              value={scheduledAt ?? nextHour()}
              mode="datetime"
              onChange={(event, date) => {
                if (Platform.OS === "android") setShowPicker(false);
                if (event.type === "set" && date) setScheduledAt(date);
              }}
            />
          ) : null}
          {!isScheduled && scheduledAt ? (
            <Button
              title="Schedule & queue"
              variant="filled"
              onPress={() => scheduleMutation.mutate()}
              disabled={scheduleMutation.isPending || selectedAccounts.size === 0}
              style={{ marginTop: 8 }}
            />
          ) : null}
          {isScheduled ? (
            <BodyText style={{ marginTop: 6 }}>
              Already queued — manage it from the Queue tab.
            </BodyText>
          ) : null}
        </Card>

        <View style={styles.footer}>
          {pub.status !== "published" && pub.status !== "publishing" ? (
            <Button
              title="Publish now"
              variant="tinted"
              onPress={() => publishNow.mutate()}
              disabled={publishNow.isPending || selectedAccounts.size === 0}
            />
          ) : null}
          <Button
            title="Delete draft"
            variant="destructive"
            onPress={() =>
              Alert.alert("Delete draft?", "This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => deleteDraft.mutate() },
              ])
            }
            disabled={deleteDraft.isPending}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        pressed && { opacity: 0.6 },
        {
          backgroundColor: active ? `${colors.tint}26` : colors.card,
          borderColor: active ? colors.tint : colors.separator,
        },
      ]}
    >
      <Text style={{ color: active ? colors.tint : colors.text, fontSize: 14, fontWeight: "500" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function nextHour(): Date {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

const styles = StyleSheet.create({
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    padding: 20,
    gap: 12,
    paddingBottom: 60,
  },
  attachRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thumbWrap: {
    width: 64,
    height: 64,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    backgroundColor: "rgba(128,128,128,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOrder: {
    position: "absolute",
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbOrderLeft: {
    left: -4,
  },
  thumbOrderRight: {
    right: -4,
  },
  addTile: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  successText: {
    color: "#34c759",
    fontWeight: "600",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  accountList: {
    gap: 8,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  customizeToggle: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  overrideField: {
    marginTop: 4,
  },
  scheduleCard: {
    gap: 10,
  },
  scheduleActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  scheduleButton: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  footer: {
    gap: 10,
    marginTop: 8,
  },
});
