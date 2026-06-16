import { describe, expect, it } from 'vitest'
import {
  MIN_INDEXABLE_BATTLES,
  MIN_INDEXABLE_RATED,
  robotsMeta,
  skinIsIndexable,
  sliceIsIndexable,
} from './seo'

describe('sliceIsIndexable', () => {
  it('keeps near-empty slices out of the index', () => {
    expect(sliceIsIndexable(0)).toBe(false)
    expect(sliceIsIndexable(MIN_INDEXABLE_RATED - 1)).toBe(false)
  })

  it('indexes a slice once it has enough rated skins', () => {
    expect(sliceIsIndexable(MIN_INDEXABLE_RATED)).toBe(true)
    expect(sliceIsIndexable(MIN_INDEXABLE_RATED + 50)).toBe(true)
  })
})

describe('skinIsIndexable', () => {
  it('treats never-battled skins (null/0) as not indexable', () => {
    expect(skinIsIndexable(null)).toBe(false)
    expect(skinIsIndexable(undefined)).toBe(false)
    expect(skinIsIndexable(0)).toBe(false)
  })

  it('indexes a skin once it has enough battles', () => {
    expect(skinIsIndexable(MIN_INDEXABLE_BATTLES - 1)).toBe(false)
    expect(skinIsIndexable(MIN_INDEXABLE_BATTLES)).toBe(true)
  })
})

describe('robotsMeta', () => {
  it('emits noindex,follow only when not indexable', () => {
    expect(robotsMeta(false)).toEqual([
      { name: 'robots', content: 'noindex,follow' },
    ])
    expect(robotsMeta(true)).toEqual([])
  })
})
