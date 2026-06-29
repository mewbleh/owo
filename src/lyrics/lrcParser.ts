import type { SyncedLyricLine } from '../types'

const LINE_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_SECOND = 1000
const FRACTION_DIGITS_MILLISECONDS = 3
const TIMESTAMP_PARTS = 4

interface TimestampMatch {
  token: string
  timeMs: number
}

export const parseLrc = (lyrics: string): SyncedLyricLine[] => {
  const lines: SyncedLyricLine[] = []

  for (const rawLine of lyrics.split('\n')) {
    const timestamps = getLineTimestamps(rawLine)

    if (timestamps.length === 0) {
      continue
    }

    const text = rawLine.replace(LINE_TIMESTAMP_PATTERN, '').trim()

    if (text.length === 0) {
      continue
    }

    for (const timestamp of timestamps) {
      lines.push({
        timeMs: timestamp.timeMs,
        text,
      })
    }
  }

  return lines.sort((left, right) => left.timeMs - right.timeMs)
}

const getLineTimestamps = (line: string): TimestampMatch[] => {
  const timestamps: TimestampMatch[] = []

  for (const match of line.matchAll(LINE_TIMESTAMP_PATTERN)) {
    if (match.length < TIMESTAMP_PARTS || match.index === undefined) {
      continue
    }

    const [, minutesRaw, secondsRaw, fractionsRaw = '0'] = match
    const minutes = Number(minutesRaw)
    const seconds = Number(secondsRaw)
    const fractionMs = Number(fractionsRaw.padEnd(FRACTION_DIGITS_MILLISECONDS, '0'))

    timestamps.push({
      token: match[0],
      timeMs: minutes * MILLISECONDS_PER_MINUTE + seconds * MILLISECONDS_PER_SECOND + fractionMs,
    })
  }

  return timestamps
}
