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
