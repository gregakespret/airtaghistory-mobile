import React, { useRef } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Animated, PanResponder } from "react-native";
import { Tag } from "../api";

const FRESH_COLORS: Record<string, string> = {
  fresh: "#34c759",
  stale: "#ff9500",
  old: "#ff3b30",
};

// How much of the sheet stays on screen when collapsed (just the handle header).
const PEEK = 46;

export default function TagSheet({ tags, onSelect }: { tags: Tag[]; onSelect: (tag: Tag) => void }) {
  // Height lives in a ref, not state: the PanResponder below is created once and
  // its callbacks close over these refs, so they must read the *live* value.
  const sheetH = useRef(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const collapsed = useRef(false);
  const baseY = useRef(0);

  const maxDown = () => Math.max(0, sheetH.current - PEEK);

  const snap = (toCollapsed: boolean) => {
    collapsed.current = toCollapsed;
    // useNativeDriver:false so the JS-thread setValue() during the drag and this
    // spring animate the same value without RN's "native/JS driver" conflict.
    Animated.spring(translateY, {
      toValue: toCollapsed ? maxDown() : 0,
      useNativeDriver: false,
      bounciness: 3,
      speed: 14,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // Capture on touch-down so taps AND flings both reach onPanResponderRelease.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        translateY.stopAnimation((v) => {
          baseY.current = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        const next = Math.min(Math.max(0, baseY.current + g.dy), maxDown());
        translateY.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        // A near-still release is a tap: toggle.
        if (Math.abs(g.dy) < 4 && Math.abs(g.vy) < 0.2) {
          snap(!collapsed.current);
          return;
        }
        if (g.vy > 0.35) return snap(true); // fling down
        if (g.vy < -0.35) return snap(false); // fling up
        const cur = Math.min(Math.max(0, baseY.current + g.dy), maxDown());
        snap(cur > maxDown() / 2); // settle to nearest
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.sheet, { transform: [{ translateY }] }]}
      onLayout={(e) => {
        sheetH.current = e.nativeEvent.layout.height;
      }}
    >
      <View style={styles.handle} {...pan.panHandlers}>
        <View style={styles.grabber} />
        <Text style={styles.handleLabel}>{tags.length} tags</Text>
      </View>
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "45%",
    backgroundColor: "rgba(255,255,255,0.96)", borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingBottom: 24, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12,
  },
  // Generous drag/tap target so the whole top strip grabs the sheet.
  handle: { height: PEEK, alignItems: "center", justifyContent: "center" },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: "#ccc" },
  handleLabel: { fontSize: 12, fontWeight: "600", color: "#8a94a2", marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontSize: 16, fontWeight: "600" },
  sub: { fontSize: 13, color: "#666", marginTop: 2 },
});
