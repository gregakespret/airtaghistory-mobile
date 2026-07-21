import React from "react";
import { View, Text, Pressable, StyleSheet, Modal } from "react-native";
import { Me } from "../api";

const PROVIDER_LABELS: Record<string, string> = { google: "Google" };

export function monogram(email: string): string {
  const first = email.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

function signedInWith(providers: string[]): string {
  if (providers.length === 0) return "Email and password";
  return providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ");
}

export default function AccountSheet({
  user,
  visible,
  onClose,
  onSignOut,
}: {
  user: Me;
  visible: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Tapping the dimmed area behind the sheet dismisses it. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close account" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{monogram(user.email)}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
            <Text style={styles.meta}>Signed in with {signedInWith(user.providers)}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Time zone</Text>
          <Text style={styles.rowValue}>{user.timezone ?? "Not set"}</Text>
        </View>

        <Pressable
          style={styles.signOutRow}
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 36, gap: 4,
  },
  handle: {
    alignSelf: "center", width: 36, height: 5, borderRadius: 3,
    backgroundColor: "#d8d8d8", marginBottom: 16,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "#007aff",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  identityText: { flex: 1 },
  email: { fontSize: 17, fontWeight: "600", color: "#1a1a1a" },
  meta: { fontSize: 13, color: "#888", marginTop: 2 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5e5",
  },
  rowLabel: { fontSize: 16, color: "#1a1a1a" },
  rowValue: { fontSize: 16, color: "#888" },
  signOutRow: {
    paddingVertical: 16, alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5e5",
  },
  signOutText: { fontSize: 16, fontWeight: "600", color: "#ff3b30" },
});
