// Small API client for the Go API described in CONTRACT.md.
//
// - In the browser it uses `import.meta.env.VITE_API_URL` (defaults to `/api`,
//   served same-origin via reverse proxy in production).
// - During SSR it uses `process.env.API_INTERNAL_URL` to reach the Go service
//   directly over the internal network (falls back to VITE_API_URL).
//
// Authenticated calls receive a Logto access token (audience = the API
// resource) which is attached as `Authorization: Bearer <token>`.

import type { Champion, Me, Skin, UpdateMeRequest } from './types'
import { getPublicConfig } from './config'

const isServer = typeof window === 'undefined'

function baseUrl(): string {
  if (isServer) {
    // SSR: prefer the internal URL; strip a trailing slash.
    const internal =
      (typeof process !== 'undefined' && process.env?.API_INTERNAL_URL) || ''
    if (internal) return internal.replace(/\/$/, '') + '/api'
  }
  // Browser (or SSR fallback): the public/proxied URL from runtime config.
  return getPublicConfig().apiUrl.replace(/\/$/, '')
}

export interface ApiError extends Error {
  status: number
}

async function request<T>(
  path: string,
  opts: {
    method?: string
    token?: string | null
    body?: unknown
  } = {},
): Promise<T> {
  const { method = 'GET', token, body } = opts

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return undefined as T

  let data: any = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const err = new Error(
      (data && data.error) || `Request failed (${res.status})`,
    ) as ApiError
    err.status = res.status
    throw err
  }

  return data as T
}

export const api = {
  // ── Public reads ────────────────────────────────────────────────
  champions: (token?: string | null) =>
    request<Champion[]>('/champions', { token }),

  champion: (id: string, token?: string | null) =>
    request<Champion>(`/champions/${encodeURIComponent(id)}`, { token }),

  skins: (token?: string | null) => request<Skin[]>('/skins', { token }),

  // ── Authenticated ───────────────────────────────────────────────
  me: (token: string) => request<Me>('/me', { token }),

  updateMe: (body: UpdateMeRequest, token: string) =>
    request<Me>('/me', { method: 'PATCH', token, body }),

  deleteAccount: (token: string) =>
    request<{ message: string }>('/user', { method: 'DELETE', token }),
}
