// Daily seed system: the same puzzle for everyone, deterministic from the
// puzzle date, resets at midnight US Central (see dailyTz).

import { createHash } from 'node:crypto'

// The current puzzle date and timezone live in dailyTz (isomorphic, so the
// reset countdown in client components shares one source of truth).
export { PUZZLE_TZ, puzzleDay } from '../dailyTz'

export const MAX_GUESSES = 6

// Puzzle #1's date. Counting in days from here gives the share-text number.
export const SPLASHDLE_EPOCH = '2026-06-11'

export function puzzleNumber(date: string, epoch = SPLASHDLE_EPOCH): number {
  const ms = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${epoch}T00:00:00Z`)
  return Math.floor(ms / 86_400_000) + 1
}

// n deterministic floats in [0, 1) derived from a seed string. Hash chaining
// (not a stateful PRNG) so the same seed always yields the same sequence.
export function seedFloats(seed: string, n: number): number[] {
  const out: number[] = []
  let block = createHash('sha256').update(seed).digest()
  let offset = 0
  while (out.length < n) {
    if (offset + 4 > block.length) {
      block = createHash('sha256').update(block).digest()
      offset = 0
    }
    out.push(block.readUInt32BE(offset) / 0x1_0000_0000)
    offset += 4
  }
  return out
}
