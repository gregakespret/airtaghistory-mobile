import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Platform } from "react-native";
import MapView, { Marker, Callout, Polyline, Region } from "react-native-maps";
import { api, Tag, Snapshot, ApiError } from "../api";
import { useAuth } from "../auth";
import AccountSheet, { monogram } from "../components/AccountSheet";
import TagSheet from "../components/TagSheet";
import TimeSlider from "../components/TimeSlider";
import { buildTimeline, positionsAt, trailFor } from "../timetravel";

function regionForTags(tags: Tag[]): Region | undefined {
  if (tags.length === 0) return undefined;
  const lats = tags.map((t) => t.latitude);
  const lons = tags.map((t) => t.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.02, (maxLon - minLon) * 1.5),
  };
}

type Pin = { id: string; name: string; lat: number; lon: number; ago: string; location_name: string | null; color: string };

// How long each historical snapshot is shown during playback.
const PLAY_INTERVAL_MS = 600;

// No safe-area-context in this project; mirrors TimeSlider's approximation so
// the avatar and the clock toggle sit on the same line.
const TOP_INSET = Platform.OS === "ios" ? 54 : 24;

const FRESH_COLORS: Record<string, string> = {
  fresh: "#34c759",
  stale: "#ff9500",
  old: "#ff3b30",
};

export default function MapScreen() {
  const { user, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stepHours, setStepHours] = useState(1); // history advanced per playback tick: 1h / 4h / 24h
  const mapRef = useRef<MapView>(null);

  const focusTag = (t: Tag) => {
    mapRef.current?.animateToRegion(
      { latitude: t.latitude, longitude: t.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      350,
    );
  };

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.getTags(), api.getSnapshots()]);
      setTags(t);
      setSnapshots(s);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut();
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => {
    load();
  }, [load]);

  const timeline = buildTimeline(snapshots);

  // While playing, advance the cursor by `stepHours` of history each tick,
  // snapping to the first snapshot at/after the target time (always progressing).
  useEffect(() => {
    if (!playing || timeline.length < 2) return;
    const stepMs = stepHours * 3600 * 1000;
    const id = setInterval(() => {
      setIndex((i) => {
        const targetMs = timeline[i] + stepMs;
        let j = i + 1;
        while (j < timeline.length && timeline[j] < targetMs) j++;
        return Math.min(j, timeline.length - 1);
      });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, timeline.length, stepHours]);

  // Reaching "now" ends playback and returns the map to Live.
  useEffect(() => {
    if (playing && timeline.length > 0 && index >= timeline.length - 1) {
      setPlaying(false);
      setLive(true);
    }
  }, [playing, index, timeline.length]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const selectedMs = timeline.length ? timeline[Math.min(index, timeline.length - 1)] : Date.now();
  const effectiveMs = live ? (timeline[timeline.length - 1] ?? Date.now()) : selectedMs;

  // A tag keeps its freshness color in both live and historical views.
  const colorForTag = (id: string) => {
    const t = tags.find((x) => x.tag_identifier === id);
    return (t && FRESH_COLORS[t.freshness]) || "#007aff";
  };

  const historical = positionsAt(snapshots, effectiveMs);
  const pins: Pin[] = live
    ? tags.map((t) => ({
        id: t.tag_identifier,
        name: t.tag_name,
        lat: t.latitude,
        lon: t.longitude,
        ago: t.ago,
        location_name: t.location_name,
        color: FRESH_COLORS[t.freshness] ?? "#007aff",
      }))
    : Array.from(historical.values()).map((s) => ({
        id: s.tag_identifier,
        name: s.tag_name,
        lat: s.latitude,
        lon: s.longitude,
        ago: s.ago,
        location_name: null,
        color: colorForTag(s.tag_identifier),
      }));

  const eff = new Date(effectiveMs);
  const olderThanWeek = Date.now() - effectiveMs > 7 * 24 * 60 * 60 * 1000;
  const labelOpts: Intl.DateTimeFormatOptions = olderThanWeek
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { weekday: "short", hour: "2-digit", minute: "2-digit" };
  if (olderThanWeek && eff.getFullYear() !== new Date().getFullYear()) labelOpts.year = "numeric";
  const label = eff.toLocaleString([], labelOpts);

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={regionForTags(tags)}>
        {!live &&
          tags.map((t) => {
            const trail = trailFor(snapshots, t.tag_identifier, effectiveMs, 20);
            if (trail.length < 2) return null;
            return (
              <Polyline
                key={`trail-${t.tag_identifier}`}
                coordinates={trail.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))}
                strokeColor="rgba(0,122,255,0.45)"
                strokeWidth={3}
              />
            );
          })}
        {pins.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.marker}>
              <View style={styles.markerLabel}>
                <Text style={styles.markerLabelText} numberOfLines={1}>{p.name}</Text>
              </View>
              <View style={[styles.markerDot, { backgroundColor: p.color }]} />
            </View>
            <Callout>
              <View style={{ maxWidth: 220 }}>
                <Text style={{ fontWeight: "600" }}>{p.name}</Text>
                <Text>Last seen {p.ago}</Text>
                {p.location_name ? <Text>{p.location_name}</Text> : null}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
      <TimeSlider
        timeline={timeline}
        index={index}
        live={live}
        label={label}
        playing={playing}
        stepHours={stepHours}
        onCycleStep={() => setStepHours((h) => (h === 1 ? 4 : h === 4 ? 24 : 1))}
        onScrub={(i) => {
          setLive(false);
          setPlaying(false); // manual scrub interrupts playback
          setIndex(i);
        }}
        onLive={() => {
          setLive(true);
          setPlaying(false);
        }}
        onTogglePlay={() => setPlaying((p) => !p)}
      />
      <TagSheet tags={tags} onSelect={focusTag} />
      {user && (
        <>
          <Pressable
            style={styles.avatar}
            onPress={() => setAccountOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Account"
          >
            <Text style={styles.avatarText}>{monogram(user.email)}</Text>
          </Pressable>
          <AccountSheet
            user={user}
            visible={accountOpen}
            onClose={() => setAccountOpen(false)}
            onSignOut={() => {
              setAccountOpen(false);
              signOut();
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  marker: { alignItems: "center" },
  markerLabel: {
    backgroundColor: "rgba(255,255,255,0.96)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    marginBottom: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(0,0,0,0.1)",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  markerLabelText: { fontSize: 12, fontWeight: "600", color: "#1a1a1a", maxWidth: 140 },
  markerDot: {
    width: 15, height: 15, borderRadius: 8, borderWidth: 2.5, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  avatar: {
    position: "absolute", top: TOP_INSET, right: 16, zIndex: 10,
    width: 38, height: 38, borderRadius: 19, backgroundColor: "#007aff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
