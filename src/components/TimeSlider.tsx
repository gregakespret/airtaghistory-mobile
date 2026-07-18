import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Platform } from "react-native";
import Slider from "@react-native-community/slider";

// No safe-area-context in this project; approximate the top inset so the
// controls clear the Dynamic Island / notch.
const TOP_INSET = Platform.OS === "ios" ? 54 : 24;

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
          <Pressable style={[styles.live, live && styles.liveOn]} onPress={onLive}>
            <Text style={[styles.liveText, live && styles.liveTextOn]}>⚡ Live</Text>
          </Pressable>
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
  live: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#eee" },
  liveOn: { backgroundColor: "#007aff" },
  liveText: { fontSize: 13, fontWeight: "600", color: "#333" },
  liveTextOn: { color: "#fff" },
});
