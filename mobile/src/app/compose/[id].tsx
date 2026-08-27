import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
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
  IconButton,
  Screen,
  SectionHeader,
  StatusBadge,
  TextField,
  useColors,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api/client";
import { applyPickerValue, firstPickerStep, type PickerStep } from "@/lib/date-time-picker";
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
  const [pickerStep, setPickerStep] = useState<PickerStep | null>(null);
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
      return new Error("This post changed elsewhere. Pulling the latest version...");
    }
    return new Error(await errorMessage(response, fallback));
  }

  async function resolveAttachments(): Promise<string[]> {
    const mediaIds: string[] = [];
    for (const attachment of attachments) {
      if (attachment.mediaId) {
        mediaIds.push(attachment.mediaId);
        continue;
      }
      if (!attachment.uri) continue;
      setAttachments((current) =>
        current.map((item) =>
          item.localId === attachment.localId ? { ...item, status: "uploading" } : item,
        ),
      );
      try {
        const pendingAttachment: PendingAttachment = {
          localId: attachment.localId,
          uri: attachment.uri,
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          size: attachment.size,
        };
        const mediaId = await uploadAttachment(pendingAttachment);
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

  async function persist(): Promise<number> {
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
      if (removal.error) throw await httpError(removal.response, "Could not remove destination");
      nextRevision += 1;
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
        params: {
          path: { id },
          query: { confirm: true, expected_revision: revision },
        },
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
      setPickerStep(null);
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
      <View style={[styles.modalHeader, { borderBottomColor: colors.separator }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel editing"
          onPress={() => router.back()}
          style={styles.headerAction}
        >
          <Text style={{ color: colors.tint, fontSize: 17 }}>Cancel</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusBadge status={pub.status} />
          {saveAndClose.isPending ? <ActivityIndicator size="small" color={colors.tint} /> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save draft"
          accessibilityState={{ disabled: saveAndClose.isPending }}
          onPress={() => saveAndClose.mutate()}
          disabled={saveAndClose.isPending}
          style={styles.headerAction}
        >
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
          <Card accessibilityRole="alert">
            <BodyText style={[styles.successText, { color: colors.success, textAlign: "center" }]}>
              {statusMessage}
            </BodyText>
          </Card>
        ) : null}
        {actionError ? (
          <BodyText accessibilityRole="alert" style={{ color: colors.danger }}>
            {actionError}
          </BodyText>
        ) : null}

        <TextField
          value={title}
          onChangeText={setTitle}
          accessibilityLabel="Post title"
          placeholder="Title"
          style={{ fontSize: 17, fontWeight: "600" }}
        />

        <TextField
          value={body}
          onChangeText={setBody}
          accessibilityLabel="Post text"
          placeholder="What do you want to say?"
          multiline
          textAlignVertical="top"
          style={{ lineHeight: 22, minHeight: 140 }}
        />

        <View style={styles.attachmentList}>
          {attachments.map((attachment, index) => (
            <View
              key={attachment.localId}
              style={[
                styles.attachmentRow,
                { backgroundColor: colors.card, borderColor: colors.separator },
              ]}
            >
              <View style={styles.thumbWrap}>
                {attachment.uri ? (
                  <Image source={{ uri: attachment.uri }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <SymbolView
                      name={{ ios: "photo", android: "image" }}
                      size={24}
                      tintColor={colors.textSecondary}
                    />
                  </View>
                )}
                {attachment.status === "uploading" ? (
                  <View style={styles.thumbOverlay}>
                    <ActivityIndicator size="small" color={colors.onTint} />
                  </View>
                ) : attachment.status === "error" ? (
                  <View style={[styles.thumbOverlay, { backgroundColor: `${colors.danger}99` }]}>
                    <Text
                      style={{
                        color: colors.onTint,
                        fontSize: 16,
                        fontWeight: "700",
                      }}
                    >
                      !
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.attachmentDetails}>
                <BodyText numberOfLines={1} style={{ color: colors.text }}>
                  {attachment.filename}
                </BodyText>
                <View style={styles.attachmentActions}>
                  {index > 0 ? (
                    <IconButton
                      label="Move attachment earlier"
                      name={{ ios: "chevron.left", android: "chevron_left" }}
                      onPress={() => moveAttachment(index, -1)}
                    />
                  ) : null}
                  {index < attachments.length - 1 ? (
                    <IconButton
                      label="Move attachment later"
                      name={{ ios: "chevron.right", android: "chevron_right" }}
                      onPress={() => moveAttachment(index, 1)}
                    />
                  ) : null}
                  <IconButton
                    label={`Remove ${attachment.filename}`}
                    name={{ ios: "trash", android: "delete" }}
                    color={colors.danger}
                    onPress={() => removeAttachment(attachment.localId)}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.attachRow}>
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
            <SymbolView
              name={{ ios: "photo.badge.plus", android: "add_photo_alternate" }}
              size={24}
              tintColor={colors.tint}
            />
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
            <SymbolView
              name={{ ios: "camera", android: "photo_camera" }}
              size={24}
              tintColor={colors.tint}
            />
          </Pressable>
        </View>

        <SectionHeader label="Destinations" />
        {(socialSets.data?.length ?? 0) > 0 ? (
          <View style={styles.chipRow}>
            {[...(socialSets.data ?? [])]
              .sort((a, b) => Number(b.is_default === true) - Number(a.is_default === true))
              .map((set) => (
                <Chip
                  key={set.id}
                  label={set.name}
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
                      selected && {
                        borderColor: colors.tint,
                        borderWidth: 1.5,
                      },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        selected && {
                          backgroundColor: colors.tint,
                          borderColor: colors.tint,
                        },
                        { borderColor: colors.separator },
                      ]}
                    >
                      {selected ? (
                        <SymbolView
                          name={{ ios: "checkmark", android: "check" }}
                          size={15}
                          tintColor={colors.onTint}
                        />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 15,
                          fontWeight: "500",
                        }}
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
                        accessibilityRole="button"
                        accessibilityState={{
                          expanded: expandedAccount === accountId,
                        }}
                        onPress={() =>
                          setExpandedAccount(expandedAccount === accountId ? null : accountId)
                        }
                        style={styles.customizeToggle}
                      >
                        <Text
                          style={{
                            color: colors.tint,
                            fontSize: 14,
                            fontWeight: "500",
                          }}
                        >
                          {expandedAccount === accountId
                            ? "Hide customization"
                            : "Customize for this platform"}
                        </Text>
                      </Pressable>
                      {expandedAccount === accountId ? (
                        <TextField
                          value={renditionBodies[accountId] ?? ""}
                          accessibilityLabel={`Custom text for ${platformLabel(account.platform)}`}
                          onChangeText={(text) =>
                            setRenditionBodies((current) => ({
                              ...current,
                              [accountId]: text,
                            }))
                          }
                          placeholder="Leave empty to use the main text..."
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
              title={pickerStep ? "Hide picker" : "Pick time"}
              variant="tinted"
              onPress={() =>
                setPickerStep((current) =>
                  current ? null : firstPickerStep(Platform.OS === "android" ? "android" : "ios"),
                )
              }
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
          {pickerStep ? (
            <DateTimePicker
              value={scheduledAt ?? nextHour()}
              mode={pickerStep}
              onChange={(event, date) => {
                if (event.type !== "set" || !date) {
                  setPickerStep(null);
                  return;
                }
                const result = applyPickerValue(scheduledAt ?? nextHour(), date, pickerStep);
                setScheduledAt(result.value);
                setPickerStep(result.nextStep);
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
              Already queued. Manage it from the Queue tab.
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
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => deleteDraft.mutate(),
                },
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
      hitSlop={8}
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
      <Text
        style={{
          color: active ? colors.tint : colors.text,
          fontSize: 14,
          fontWeight: "500",
        }}
      >
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
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerAction: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
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
  attachmentList: {
    gap: 8,
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 80,
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentDetails: {
    flex: 1,
    gap: 2,
  },
  attachmentActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    minHeight: 48,
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
    minHeight: 48,
    justifyContent: "center",
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
    minHeight: 48,
    paddingHorizontal: 12,
  },
  footer: {
    gap: 10,
    marginTop: 8,
  },
});
