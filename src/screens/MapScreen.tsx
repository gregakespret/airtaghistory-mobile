import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import MapView, { Marker, Callout, Polyline, Region } from "react-native-maps";
import { api, Tag, Snapshot, ApiError } from "../api";
import { useAuth } from "../auth";
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

type Pin = { id: string; name: string; lat: number; lon: number; ago: string; location_name: string | null };

export default function MapScreen() {
  const { signOut } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [index, setIndex] = useState(0);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const timeline = buildTimeline(snapshots);
  const selectedMs = timeline.length ? timeline[Math.min(index, timeline.length - 1)] : Date.now();
  const effectiveMs = live ? (timeline[timeline.length - 1] ?? Date.now()) : selectedMs;

  const historical = positionsAt(snapshots, effectiveMs);
  const pins: Pin[] = live
    ? tags.map((t) => ({
        id: t.tag_identifier,
        name: t.tag_name,
        lat: t.latitude,
        lon: t.longitude,
        ago: t.ago,
        location_name: t.location_name,
      }))
    : Array.from(historical.values()).map((s) => ({
        id: s.tag_identifier,
        name: s.tag_name,
        lat: s.latitude,
        lon: s.longitude,
        ago: s.ago,
        location_name: null,
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
          <Marker key={p.id} coordinate={{ latitude: p.lat, longitude: p.lon }} title={p.name}>
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
        onScrub={(i) => {
          setLive(false);
          setIndex(i);
        }}
        onLive={() => setLive(true)}
      />
      <TagSheet tags={tags} onSelect={focusTag} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});
