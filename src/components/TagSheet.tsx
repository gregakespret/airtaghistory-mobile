import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Tag } from "../api";

const FRESH_COLORS: Record<string, string> = {
  fresh: "#34c759",
  stale: "#ff9500",
  old: "#ff3b30",
};

export default function TagSheet({ tags, onSelect }: { tags: Tag[]; onSelect: (tag: Tag) => void }) {
  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />
      <ScrollView>
        {tags.map((t) => (
          <Pressable key={t.tag_identifier} style={styles.row} onPress={() => onSelect(t)}>
            <View style={[styles.dot, { backgroundColor: FRESH_COLORS[t.freshness] ?? "#999" }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.tag_name}</Text>
              <Text style={styles.sub}>
                {t.location_name ? `${t.location_name} · ` : ""}
                {t.ago}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "45%",
    backgroundColor: "rgba(255,255,255,0.96)", borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingBottom: 24, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12,
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#ccc", marginVertical: 10 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontSize: 16, fontWeight: "600" },
  sub: { fontSize: 13, color: "#666", marginTop: 2 },
});
