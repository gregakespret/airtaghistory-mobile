import { Snapshot } from "./api";

export function buildTimeline(snapshots: Snapshot[]): number[] {
  return Array.from(new Set(snapshots.map((s) => s.ts_ms))).sort((a, b) => a - b);
}

export function positionsAt(snapshots: Snapshot[], tMs: number): Map<string, Snapshot> {
  const out = new Map<string, Snapshot>();
  for (const s of snapshots) {
    if (s.ts_ms > tMs) continue;
    const cur = out.get(s.tag_identifier);
    if (!cur || s.ts_ms > cur.ts_ms) out.set(s.tag_identifier, s);
  }
  return out;
}

export function trailFor(snapshots: Snapshot[], tagId: string, tMs: number, count: number): Snapshot[] {
  return snapshots
    .filter((s) => s.tag_identifier === tagId && s.ts_ms <= tMs)
    .sort((a, b) => a.ts_ms - b.ts_ms)
    .slice(-count);
}
