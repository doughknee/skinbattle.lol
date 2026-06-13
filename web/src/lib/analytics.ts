import type { PostHog } from 'posthog-js'

// One contract for every star/ban capture, so "stars by champion" and
// "stars by skin" breakdowns are complete no matter which surface the vote
// came from. The battle-arena variant historically dropped skin_name and
// champion_id, silently undercounting those breakdowns; routing all four
// surfaces (skin card, home hero, battle arena, quota chip) through here
// keeps the property set identical everywhere.

export type SkinVoteAction = 'star' | 'unstar' | 'ban' | 'unban'

export type SkinVoteSource =
  | 'skin_card'
  | 'home_hero'
  | 'battle_arena'
  | 'quota_chip'

export interface SkinVoteContext {
  skinId: string
  skinName?: string
  championId?: string
  // The user's spent count for this currency AFTER the change (stars or bans).
  used: number
  source: SkinVoteSource
}

const EVENT: Record<SkinVoteAction, string> = {
  star: 'skin_starred',
  unstar: 'skin_unstarred',
  ban: 'skin_banned',
  unban: 'skin_unbanned',
}

export function captureSkinVote(
  posthog: PostHog,
  action: SkinVoteAction,
  ctx: SkinVoteContext,
): void {
  const isStar = action === 'star' || action === 'unstar'
  const props: Record<string, unknown> = {
    skin_id: ctx.skinId,
    [isStar ? 'stars_used' : 'bans_used']: ctx.used,
    source: ctx.source,
  }
  // Omit absent dimensions rather than sending undefined so the event schema
  // stays clean.
  if (ctx.skinName) props.skin_name = ctx.skinName
  if (ctx.championId) props.champion_id = ctx.championId
  posthog.capture(EVENT[action], props)
}
