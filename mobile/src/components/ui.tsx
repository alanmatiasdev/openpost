import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useColorScheme } from "react-native";

import { STATUS_COLOR, STATUS_LABEL } from "@/lib/format";

export function useColors() {
  const scheme = useColorScheme();
  const dark = scheme !== "light";
  return {
    dark,
    bg: dark ? "#000000" : "#f2f2f7",
    card: dark ? "#1c1c1e" : "#ffffff",
    text: dark ? "#ffffff" : "#000000",
    textSecondary: dark ? "#98989f" : "#6c6c70",
    separator: dark ? "#38383a" : "#e5e5ea",
    tint: dark ? "#0a84ff" : "#007aff",
    danger: "#ff453a",
    inputBg: dark ? "#2c2c2e" : "#f2f2f7",
  };
}

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{children}</View>;
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card }, style]}>{children}</View>;
}

export function SectionHeader({ label }: { label: string }) {
  const colors = useColors();
  return (
    <Text
      style={[
        styles.sectionHeader,
        {
          color: colors.textSecondary,
        },
      ]}
    >
      {label.toUpperCase()}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = "filled",
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "filled" | "tinted" | "plain" | "destructive";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const background =
    variant === "filled"
      ? colors.tint
      : variant === "destructive"
        ? "transparent"
        : variant === "tinted"
          ? `${colors.tint}22`
          : "transparent";
  const color =
    variant === "filled" ? "#ffffff" : variant === "destructive" ? colors.danger : colors.tint;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function TextField({ style, ...props }: React.ComponentProps<typeof TextInput>) {
  const colors = useColors();
  return (
    <TextInput
      placeholderTextColor={colors.textSecondary}
      {...props}
      style={[
        styles.textField,
        {
          backgroundColor: colors.inputBg,
          color: colors.text,
        },
        style,
      ]}
    />
  );
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#8e8e93";
  return (
    <View style={[styles.badge, { backgroundColor: `${color}26` }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={{ color, fontSize: 12, fontWeight: "600" }}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}

export function BodyText({ children, style, ...props }: React.ComponentProps<typeof Text>) {
  const colors = useColors();
  return (
    <Text style={[{ color: colors.textSecondary, fontSize: 14 }, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  button: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  textField: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
