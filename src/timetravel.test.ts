import { buildTimeline, positionsAt, trailFor } from "./timetravel";
import { Snapshot } from "./api";

const snap = (tag: string, ts_ms: number): Snapshot => ({
  tag_identifier: tag, tag_name: tag, latitude: ts_ms, longitude: ts_ms,
  accuracy: null, timestamp: new Date(ts_ms).toISOString(), ts_ms, ago: "",
});

const data: Snapshot[] = [
  snap("A", 100), snap("A", 300), snap("B", 200), snap("A", 500), snap("B", 400),
];

test("buildTimeline returns sorted unique timestamps", () => {
  expect(buildTimeline(data)).toEqual([100, 200, 300, 400, 500]);
});

test("positionsAt returns most-recent per tag at or before t", () => {
  const at = positionsAt(data, 350);
  expect(at.get("A")?.ts_ms).toBe(300);
  expect(at.get("B")?.ts_ms).toBe(200);
});

test("trailFor returns up-to-count recent points oldest-first", () => {
  const trail = trailFor(data, "A", 500, 2);
  expect(trail.map((s) => s.ts_ms)).toEqual([300, 500]);
});
