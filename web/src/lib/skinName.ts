// Display-name helpers for champions and skins.

// Champions whose DDragon id doesn't turn into their real name by splitting
// CamelCase: apostrophes, punctuation, and outright renames (Riot's data id
// for Wukong is "MonkeyKing"). A new champion only needs an entry when its
// id and name diverge - most don't.
const CHAMPION_NAME_EXCEPTIONS: Record<string, string> = {
  Belveth: "Bel'Veth",
  Chogath: "Cho'Gath",
  DrMundo: 'Dr. Mundo',
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  KSante: "K'Sante",
  Leblanc: 'LeBlanc',
  MonkeyKing: 'Wukong',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  Velkoz: "Vel'Koz",
}

// DDragon champion ids are PascalCase ("MissFortune"). Insert spaces at
// lower→upper boundaries for display ("Miss Fortune"); ids that need more
// than a space come from the exceptions map above.
export function championDisplayName(championId: string): string {
  return (
    CHAMPION_NAME_EXCEPTIONS[championId] ??
    championId.replace(/([a-z])([A-Z])/g, '$1 $2')
  )
}

// DDragon names the base skin "default" - render it as "Classic <Champion>".
export function displaySkinName(skinName: string, championId: string): string {
  if (skinName.trim().toLowerCase() === 'default') {
    return `Classic ${championDisplayName(championId)}`
  }
  return skinName
}

// Letters and digits only, so punctuation and casing cannot split a match.
const bare = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()

// The name a skin's <title> and share card use. Most skin names already carry
// their champion ("Elementalist Lux"), but 45 do not - "Birdio", "Emumu",
// "Urfwick", "Captain Fortune" - and a title reading "Birdio · Skin Battle"
// tells a searcher nothing about what it is. Appending the champion where the
// name lacks it disambiguates those, and disambiguates any two skins that ever
// come to share a name (none do today) for free.
// Degrades rather than dangling: this string is a <title> on ~1,900 pages, and
// "(Lux)" with nothing in front of it is worse than a plain name.
export function skinTitleName(skinName: string, championName: string): string {
  const skin = skinName.trim()
  const champion = championName.trim()
  if (!skin) return champion || 'Skin'
  if (!champion || bare(skin).includes(bare(champion))) return skin
  return `${skin} (${champion})`
}
