import { API_BASE_URL } from "./config";

export type User = { id: number; email: string; timezone: string | null };

export type Tag = {
  tag_identifier: string;
  tag_name: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
  ago: string;
  freshness: string;
  location_name: string | null;
};

export type Snapshot = {
  tag_identifier: string;
  tag_name: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
  ts_ms: number;
  ago: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let _token: string | null = null;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  setToken(token: string | null) {
    _token = token;
  },
  async login(email: string, password: string) {
    return request<{ token: string; user: User }>("/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  getTags() {
    return request<Tag[]>("/api/tags");
  },
  getSnapshots() {
    return request<Snapshot[]>("/api/snapshots");
  },
};
