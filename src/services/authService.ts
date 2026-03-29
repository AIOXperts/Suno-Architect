export interface AuthUser {
  id: number;
  email: string;
  role: "user" | "admin";
  createdAt: string;
}

export const AUTH_BYPASS_ENABLED =
  String(import.meta.env.VITE_DISABLE_AUTH || "").toLowerCase() === "true";

const BYPASS_USER: AuthUser = {
  id: -1,
  email: "local@bypass",
  role: "admin",
  createdAt: new Date(0).toISOString(),
};

function getBaseUrl(): string {
  return "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${getBaseUrl()}${path}`, { ...init, headers, credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body as T;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  if (AUTH_BYPASS_ENABLED) return BYPASS_USER;
  const data = await request<{ user: AuthUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  if (AUTH_BYPASS_ENABLED) return BYPASS_USER;
  const data = await request<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export async function me(): Promise<AuthUser> {
  if (AUTH_BYPASS_ENABLED) return BYPASS_USER;
  const data = await request<{ user: AuthUser }>("/api/auth/me", { method: "GET" });
  return data.user;
}

export async function logout(): Promise<void> {
  if (AUTH_BYPASS_ENABLED) return;
  await request<{ success: boolean }>("/api/auth/logout", { method: "POST" });
}
