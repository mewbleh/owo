import { describe, expect, it } from 'vitest'

import { parseLrc } from '../src/lyrics/lrcParser'

describe('parseLrc', () => {
  it('parses synced lyric lines in timestamp order', () => {
    const lyrics = [
      '[00:10.50]second line',
      '[00:01.250]first line',
      '[00:20]third line',
    ].join('\n')

    expect(parseLrc(lyrics)).toEqual([
      { timeMs: 1250, text: 'first line' },
      { timeMs: 10500, text: 'second line' },
      { timeMs: 20000, text: 'third line' },
    ])
  })

  it('expands multiple timestamps on one lyric line', () => {
    const lyrics = '[00:01.00][00:02.50]echo'

    expect(parseLrc(lyrics)).toEqual([
      { timeMs: 1000, text: 'echo' },
      { timeMs: 2500, text: 'echo' },
    ])
  })

  it('skips metadata and empty timed lines', () => {
    const lyrics = ['[ar:artist]', '[00:01.00]', '[00:02.00]real line'].join('\n')

    expect(parseLrc(lyrics)).toEqual([{ timeMs: 2000, text: 'real line' }])
  })
})
