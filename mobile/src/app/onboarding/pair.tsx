import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { BodyText, Button, Card, Screen, useColors } from "@/components/ui";
import { pollPairing, startPairing } from "@/lib/auth";

type Phase = "starting" | "waiting" | "approved" | "denied" | "expired" | "error";

export default function PairScreen() {
  const colors = useColors();
  const [phase, setPhase] = useState<Phase>("starting");
  const [userCode, setUserCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deviceCode = useRef("");
  const cancelled = useRef(false);

  async function pollLoop() {
    while (!cancelled.current) {
      try {
        const result = await pollPairing(deviceCode.current);
        if (cancelled.current) return;
        if (result.status === "pending") {
          await sleep(result.intervalMs);
          continue;
        }
        if (result.status === "approved") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setPhase("approved");
          setTimeout(() => router.replace("/onboarding/workspace"), 500);
        } else {
          setPhase(result.status);
        }
        return;
      } catch {
        await sleep(3000);
      }
    }
  }

  useEffect(() => {
    cancelled.current = false;
    void (async () => {
      try {
        const state = await startPairing();
        if (cancelled.current) return;
        deviceCode.current = state.deviceCode;
        setUserCode(state.userCode);
        setVerificationUrl(state.verificationUrl);
        setPhase("waiting");
        void pollLoop();
      } catch (err) {
        if (!cancelled.current) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Could not start pairing");
        }
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function restart() {
    setError(null);
    setPhase("starting");
    router.replace("/onboarding/pair");
  }

  const title =
    phase === "approved"
      ? "Paired!"
      : phase === "denied"
        ? "Pairing denied"
        : phase === "expired"
          ? "Code expired"
          : phase === "error"
            ? "Something went wrong"
            : "Pair this device";

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {phase !== "approved" ? (
        <BodyText style={styles.subtitle}>
          Approve on any device where you are already signed in to OpenPost. SSO organizations
          should use this method.
        </BodyText>
      ) : null}

      {phase === "starting" || phase === "waiting" ? (
        <>
          <Card style={styles.codeCard}>
            {phase === "starting" ? (
              <ActivityIndicator color={colors.tint} />
            ) : (
              <Text style={[styles.code, { color: colors.text }]} selectable>
                {userCode}
              </Text>
            )}
          </Card>
          <BodyText style={styles.center}>Enter this code at</BodyText>
          <BodyText style={[styles.center, styles.url, { color: colors.text }]}>
            {verificationUrl.replace(/^https?:\/\//, "")}
          </BodyText>
          <Button
            title="Open verification page"
            onPress={() => void WebBrowser.openBrowserAsync(verificationUrl)}
            style={styles.openButton}
          />
          <View style={styles.waitRow}>
            <ActivityIndicator color={colors.tint} />
            <BodyText> Waiting for approval…</BodyText>
          </View>
        </>
      ) : null}

      {phase === "denied" || phase === "expired" || phase === "error" ? (
        <>
          {error ? (
            <BodyText style={[styles.center, { color: colors.danger }]}>{error}</BodyText>
          ) : null}
          <Button
            title="Try again"
            variant="tinted"
            onPress={() => void restart()}
            style={styles.openButton}
          />
        </>
      ) : null}
    </Screen>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  codeCard: {
    alignItems: "center",
    paddingVertical: 24,
    marginHorizontal: 20,
  },
  code: {
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: 6,
  },
  center: {
    textAlign: "center",
    paddingHorizontal: 20,
    marginTop: 12,
  },
  url: {
    fontWeight: "600",
  },
  openButton: {
    marginHorizontal: 20,
    marginTop: 16,
  },
  waitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
});
