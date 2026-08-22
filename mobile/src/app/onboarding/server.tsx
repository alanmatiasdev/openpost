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
import { Brand } from "@/components/brand";
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
          <Brand style={styles.brand} />
          <Text style={[styles.title, { color: colors.text }]}>Choose your OpenPost server</Text>
          <BodyText style={styles.subtitle}>
            Use our hosted service or connect to an OpenPost server you manage.
          </BodyText>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: busy !== null,
              busy: busy === "hosted",
            }}
            onPress={() => void choose(HOSTED_URL, "hosted")}
            disabled={busy !== null}
            style={({ pressed }) => pressed && { opacity: 0.72 }}
          >
            <Card style={styles.hostedCard}>
              {busy === "hosted" ? (
                <ActivityIndicator color={colors.tint} />
              ) : (
                <>
                  <Text style={[styles.hostedTitle, { color: colors.text }]}>OpenPost Hosted</Text>
                  <BodyText>Fastest setup. Sign in with your OpenPost account.</BodyText>
                  <BodyText style={{ color: colors.tint, fontWeight: "600" }}>
                    {HOSTED_URL.replace("https://", "")}
                  </BodyText>
                </>
              )}
            </Card>
          </Pressable>

          <SectionHeader label="Self-hosted instance" />
          <TextField
            value={url}
            onChangeText={setUrl}
            accessibilityLabel="Self-hosted server address"
            placeholder="openpost.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={() => void choose(url, "custom")}
          />
          <BodyText>Self-hosted servers must use HTTPS and expose the OpenPost API.</BodyText>
          {error ? (
            <BodyText accessibilityRole="alert" style={{ color: colors.danger, marginTop: 8 }}>
              {error}
            </BodyText>
          ) : null}
          <Button
            title="Connect"
            variant="tinted"
            disabled={busy !== null || url.trim().length === 0}
            loading={busy === "custom"}
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
    paddingTop: 44,
    paddingBottom: 40,
    gap: 12,
  },
  brand: {
    marginBottom: 28,
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
    minHeight: 116,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 6,
  },
  hostedTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  connectButton: {
    marginTop: 4,
  },
});
