// Stable skin URLs (client-safe). Slugs derive from names with the skin ID
// as the immutable key — Riot occasionally renames skins, so the name part
// is cosmetic and the trailing ID is what resolves. Any slug whose ID
// matches redirects to the canonical spelling; links never die.

export function kebab(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function skinSlug(name: string, skinId: string): string {
  const base = kebab(name)
  return base ? `${base}-${skinId}` : skinId
}

// "elementalist-lux-99007" → "99007"; "99007" → "99007".
export function skinIdFromSlug(slug: string): string | null {
  const m = /(\d+)$/.exec(slug)
  return m ? m[1] : null
}
