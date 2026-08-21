import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";

import {
  BodyText,
  Button,
  Card,
  Screen,
  SectionHeader,
  TextField,
  useColors,
} from "@/components/ui";
import { HOSTED_URL, probeServer, setServer } from "@/lib/server";

export default function ServerScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"hosted" | "custom" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(target: string, kind: "hosted" | "custom") {
    setBusy(kind);
    setError(null);
    const result = await probeServer(target);
    if (!result.ok) {
      setBusy(null);
      setError(result.error);
      return;
    }
    await setServer(result.baseUrl);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBusy(null);
    router.replace(params.from === "settings" ? "/" : "/onboarding/login");
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.text }]}>Welcome to OpenPost</Text>
          <BodyText style={styles.subtitle}>
            Connect to OpenPost hosted, or your own self-hosted instance.
          </BodyText>

          <Card style={styles.hostedCard}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void choose(HOSTED_URL, "hosted")}
              disabled={busy !== null}
              style={({ pressed }) => [styles.hostedButton, pressed && { opacity: 0.6 }]}
            >
              {busy === "hosted" ? (
                <ActivityIndicator color={colors.tint} />
              ) : (
                <>
                  <Text style={[styles.hostedTitle, { color: colors.text }]}>OpenPost hosted</Text>
                  <BodyText>{HOSTED_URL.replace("https://", "")}</BodyText>
                </>
              )}
            </Pressable>
          </Card>

          <SectionHeader label="Self-hosted instance" />
          <TextField
            value={url}
            onChangeText={setUrl}
            placeholder="openpost.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={() => void choose(url, "custom")}
          />
          {error ? (
            <BodyText style={{ color: colors.danger, marginTop: 8 }}>{error}</BodyText>
          ) : null}
          <Button
            title={busy === "custom" ? "Checking…" : "Connect"}
            variant="tinted"
            disabled={busy !== null || url.trim().length === 0}
            onPress={() => void choose(url, "custom")}
            style={styles.connectButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingTop: 96,
    gap: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  subtitle: {
    marginBottom: 16,
  },
  hostedCard: {
    paddingVertical: 18,
  },
  hostedButton: {
    alignItems: "flex-start",
    gap: 4,
  },
  hostedTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  connectButton: {
    marginTop: 4,
  },
});
