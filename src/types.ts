export interface SpotifyTrack {
  id: string
  name: string
  artists: string[]
  albumName: string
  durationMs: number
  progressMs: number
  isPlaying: boolean
  spotifyUrl?: string
  observedAtMs: number
}

export interface SyncedLyricLine {
  timeMs: number
  text: string
}

export interface LyricsDocument {
  trackId: string
  plainLyrics: string | null
  syncedLyrics: string | null
  syncedLines: SyncedLyricLine[]
}

export interface LyricsProvider {
  getLyricsForTrack(track: SpotifyTrack): Promise<LyricsDocument | null>
}
