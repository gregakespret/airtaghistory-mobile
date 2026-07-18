import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";

export default function TimeSlider({
  timeline, index, live, label, onScrub, onLive,
}: {
  timeline: number[];
  index: number;
  live: boolean;
  label: string;
  onScrub: (index: number) => void;
  onLive: () => void;
}) {
  if (timeline.length < 2) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{live ? "Live" : label}</Text>
        <Pressable style={[styles.live, live && styles.liveOn]} onPress={onLive}>
          <Text style={[styles.liveText, live && styles.liveTextOn]}>⚡ Live</Text>
        </Pressable>
      </View>
      <Slider
        minimumValue={0}
        maximumValue={timeline.length - 1}
        step={1}
        value={index}
        onValueChange={onScrub}
        minimumTrackTintColor="#007aff"
        maximumTrackTintColor="#ccc"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute", left: 12, right: 12, bottom: 24,
    backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 16, padding: 12,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 10,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  label: { fontSize: 15, fontWeight: "600" },
  live: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#eee" },
  liveOn: { backgroundColor: "#007aff" },
  liveText: { fontSize: 13, fontWeight: "600", color: "#333" },
  liveTextOn: { color: "#fff" },
});
