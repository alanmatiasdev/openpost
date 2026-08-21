import * as Haptics from "expo-haptics";
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
import { currentWorkspaceId, useAccounts, useSocialSets } from "@/lib/queries";

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

  /** Persist title/body/schedule/selection/overrides; returns the new revision. */
  async function persist(): Promise<number> {
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
