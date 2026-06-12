// Champion square icons from Data Dragon. Unlike the versionless splash and
// loading-screen paths used elsewhere, squares live under a patch version
// (`/cdn/<version>/img/champion/<id>.png`), so we resolve the latest version
// once per session and remember the last-known answer in localStorage for
// offline/CDN-hiccup renders.

import { useEffect, useState } from 'react'

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json'
const VERSION_KEY = 'sb:ddragon-version'

// Last resort when versions.json is unreachable and nothing is cached yet.
// Icons for champions released after this patch 404 until a fetch succeeds.
const FALLBACK_VERSION = '15.1.1'

function cachedVersion(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(VERSION_KEY)
  } catch {
    return null
  }
}

let versionPromise: Promise<string> | null = null

export function getDDragonVersion(): Promise<string> {
  if (!versionPromise) {
    versionPromise = fetch(VERSIONS_URL)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<string[]>)
          : Promise.reject(new Error(`versions.json ${res.status}`)),
      )
      .then((versions) => {
        const latest = versions[0]
        if (!latest) throw new Error('empty versions list')
        try {
          localStorage.setItem(VERSION_KEY, latest)
        } catch {
          /* storage unavailable - session cache still works */
        }
        return latest
      })
      .catch(() => {
        versionPromise = null // allow a retry on the next call
        return cachedVersion() ?? FALLBACK_VERSION
      })
  }
  return versionPromise
}

export function championIconUrl(championId: string, version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`
}

// Resolves to the cached version immediately (or '' if none), then to the
// freshly fetched one.
export function useDDragonVersion(): string {
  const [version, setVersion] = useState(() => cachedVersion() ?? '')
  useEffect(() => {
    let cancelled = false
    getDDragonVersion().then((v) => {
      if (!cancelled) setVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return version
}
