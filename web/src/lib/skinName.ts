// Display-name helpers for champions and skins.

// DDragon champion ids are PascalCase ("MissFortune"). Insert spaces at
// lower→upper boundaries for display ("Miss Fortune"); single-word ids and
// ids like "KSante" pass through unchanged.
export function championDisplayName(championId: string): string {
  return championId.replace(/([a-z])([A-Z])/g, '$1 $2')
}

// DDragon names the base skin "default" - render it as "Classic <Champion>".
export function displaySkinName(skinName: string, championId: string): string {
  if (skinName.trim().toLowerCase() === 'default') {
    return `Classic ${championDisplayName(championId)}`
  }
  return skinName
}
