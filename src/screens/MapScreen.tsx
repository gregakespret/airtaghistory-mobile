import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import MapView, { Marker, Callout, Region } from "react-native-maps";
import { api, Tag, ApiError } from "../api";
import { useAuth } from "../auth";

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

export default function MapScreen() {
  const { signOut } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setTags(await api.getTags());
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

  return (
    <View style={styles.container}>
      <MapView style={StyleSheet.absoluteFill} initialRegion={regionForTags(tags)}>
        {tags.map((t) => (
          <Marker
            key={t.tag_identifier}
            coordinate={{ latitude: t.latitude, longitude: t.longitude }}
            title={t.tag_name}
          >
            <Callout>
              <View style={{ maxWidth: 220 }}>
                <Text style={{ fontWeight: "600" }}>{t.tag_name}</Text>
                <Text>Last seen {t.ago}</Text>
                {t.location_name ? <Text>{t.location_name}</Text> : null}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});
