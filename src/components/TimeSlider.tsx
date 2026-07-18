import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Platform } from "react-native";
import Slider from "@react-native-community/slider";

// No safe-area-context in this project; approximate the top inset so the
// controls clear the Dynamic Island / notch.
const TOP_INSET = Platform.OS === "ios" ? 54 : 24;

export default function TimeSlider({
  timeline, index, live, label, playing, stepHours, onScrub, onLive, onTogglePlay, onCycleStep,
}: {
  timeline: number[];
  index: number;
  live: boolean;
  label: string;
  playing: boolean;
  stepHours: number;
  onScrub: (index: number) => void;
  onLive: () => void;
  onTogglePlay: () => void;
  onCycleStep: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [open, anim]);

  // Nothing to travel through without at least two distinct snapshots.
  if (timeline.length < 2) return null;

  const toggle = () => {
    if (open) {
      onLive(); // hiding the bar returns the map to Live
      setOpen(false);
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide time travel" : "Time travel"}
        style={[styles.clock, open && styles.clockOn]}
      >
        <Text style={styles.clockIcon}>🕐</Text>
      </Pressable>

      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[
          styles.bar,
          {
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.label}>{live ? "Live" : label}</Text>
          <View style={styles.actions}>
            {!live && (
              <>
                <Pressable
                  style={styles.speed}
                  onPress={onCycleStep}
                  accessibilityRole="button"
                  accessibilityLabel={`Playback step ${stepHours} hours, tap to change`}
                >
                  <Text style={styles.speedText}>{stepHours}h</Text>
                </Pressable>
                <Pressable
                  style={styles.play}
                  onPress={onTogglePlay}
                  accessibilityRole="button"
                  accessibilityLabel={playing ? "Pause playback" : "Play history"}
                >
                  <Text style={styles.playText}>{playing ? "⏸ Pause" : "▶ Play"}</Text>
                </Pressable>
              </>
            )}
            <Pressable style={[styles.live, live && styles.liveOn]} onPress={onLive}>
              <Text style={[styles.liveText, live && styles.liveTextOn]}>⚡ Live</Text>
            </Pressable>
          </View>
        </View>
        <Slider
          minimumValue={0}
          maximumValue={timeline.length - 1}
          step={1}
          // Live == "now" == far right; only follow index once scrubbing into the past.
          value={live ? timeline.length - 1 : index}
          onValueChange={onScrub}
          minimumTrackTintColor="#007aff"
          maximumTrackTintColor="#ccc"
        />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  clock: {
    position: "absolute", top: TOP_INSET, left: 16, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  clockOn: { backgroundColor: "#007aff" },
  clockIcon: { fontSize: 18, lineHeight: 22 },
  bar: {
    position: "absolute", top: TOP_INSET + 48, left: 12, right: 12, zIndex: 9,
    backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 16, padding: 12,
    shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  label: { fontSize: 15, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  speed: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#eee", minWidth: 34, alignItems: "center" },
  speedText: { fontSize: 13, fontWeight: "700", color: "#333", fontVariant: ["tabular-nums"] },
  play: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#eaf3ff" },
  playText: { fontSize: 13, fontWeight: "700", color: "#007aff" },
  live: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#eee" },
  liveOn: { backgroundColor: "#007aff" },
  liveText: { fontSize: 13, fontWeight: "600", color: "#333" },
  liveTextOn: { color: "#fff" },
});
