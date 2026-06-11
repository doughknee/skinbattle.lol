// Daily seed system: the same puzzle for everyone, deterministic from the
// UTC date, resets at midnight UTC.

import { createHash } from 'node:crypto'

export const MAX_GUESSES = 6

// Puzzle #1's date. Counting in days from here gives the share-text number.
export const SPLASHDLE_EPOCH = '2026-06-11'

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

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
