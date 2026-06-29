import axios from 'axios'
import type { AxiosInstance } from 'axios'

import { HttpRequestError } from '../errors'
import type { LyricsDocument, LyricsProvider, SpotifyTrack } from '../types'
import { parseLrc } from './lrcParser'

const SERVER_ERROR_STATUS = 500
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 299
const NOT_FOUND_STATUS = 404
const MILLISECONDS_PER_SECOND = 1000
const MAX_CACHE_SIZE = 128

interface LrclibClientConfig {
  baseUrl: string
}

interface LrclibLyricsResponse {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export class LrclibClient implements LyricsProvider {
  private readonly client: AxiosInstance
  private readonly cache = new Map<string, LyricsDocument | null>()

  constructor(config: LrclibClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      validateStatus: (status) => status < SERVER_ERROR_STATUS,
    })
  }

  async getLyricsForTrack(track: SpotifyTrack): Promise<LyricsDocument | null> {
    const cacheKey = track.id

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null
    }

    const response = await this.client.get<LrclibLyricsResponse>('/api/get', {
      params: {
        track_name: track.name,
        artist_name: track.artists.join(', '),
        album_name: track.albumName,
        duration: Math.round(track.durationMs / MILLISECONDS_PER_SECOND),
      },
    })

    if (response.status === NOT_FOUND_STATUS) {
      this.setCache(cacheKey, null)
      return null
    }

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError('LRCLIB lyrics request failed', response.status, '/api/get')
    }

    const document: LyricsDocument = {
      trackId: String(response.data.id),
      plainLyrics: response.data.plainLyrics,
      syncedLyrics: response.data.syncedLyrics,
      syncedLines: response.data.syncedLyrics ? parseLrc(response.data.syncedLyrics) : [],
    }

    this.setCache(cacheKey, document)
    return document
  }

  private setCache(key: string, document: LyricsDocument | null): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value as string | undefined

      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, document)
  }
}
