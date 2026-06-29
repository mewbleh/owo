import axios from 'axios'
import type { AxiosInstance } from 'axios'

import { HttpRequestError } from '../errors'
import type { SpotifyTrack } from '../types'

const SPOTIFY_API_BASE_URL = 'https://api.spotify.com'
const SPOTIFY_ACCOUNTS_BASE_URL = 'https://accounts.spotify.com'
const TOKEN_REFRESH_SKEW_MS = 60_000
const MILLISECONDS_PER_SECOND = 1000
const EMPTY_RESPONSE_STATUS = 204
const UNAUTHORIZED_STATUS = 401
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 299
const SERVER_ERROR_STATUS = 500

interface SpotifyClientConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  market?: string
}

interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

interface SpotifyArtistResponse {
  name: string
}

interface SpotifyAlbumResponse {
  name: string
}

interface SpotifyTrackResponse {
  id: string
  name: string
  artists: SpotifyArtistResponse[]
  album: SpotifyAlbumResponse
  duration_ms: number
  external_urls?: {
    spotify?: string
  }
}

interface SpotifyCurrentlyPlayingResponse {
  currently_playing_type?: string
  is_playing?: boolean
  progress_ms?: number
  item?: SpotifyTrackResponse | null
}

export class SpotifyClient {
  private readonly apiClient: AxiosInstance
  private readonly accountsClient: AxiosInstance
  private accessToken: string | null = null
  private accessTokenExpiresAtMs = 0
  private refreshToken: string

  constructor(private readonly config: SpotifyClientConfig) {
    this.refreshToken = config.refreshToken
    this.apiClient = axios.create({
      baseURL: SPOTIFY_API_BASE_URL,
      validateStatus: (status) => status < SERVER_ERROR_STATUS,
    })
    this.accountsClient = axios.create({
      baseURL: SPOTIFY_ACCOUNTS_BASE_URL,
      validateStatus: (status) => status < SERVER_ERROR_STATUS,
    })
  }

  async getCurrentlyPlayingTrack(hasRetriedUnauthorized = false): Promise<SpotifyTrack | null> {
    const response = await this.getCurrentlyPlayingResponse()

    if (response.status === UNAUTHORIZED_STATUS && !hasRetriedUnauthorized) {
      await this.refreshAccessToken(true)
      return this.getCurrentlyPlayingTrack(true)
    }

    if (response.status === EMPTY_RESPONSE_STATUS) {
      return null
    }

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError(
        'Spotify currently playing request failed',
        response.status,
        '/v1/me/player/currently-playing',
      )
    }

    const data = response.data as SpotifyCurrentlyPlayingResponse | undefined

    if (data?.currently_playing_type !== 'track' || !data.item) {
      return null
    }

    return {
      id: data.item.id,
      name: data.item.name,
      artists: data.item.artists.map((artist) => artist.name),
      albumName: data.item.album.name,
      durationMs: data.item.duration_ms,
      progressMs: data.progress_ms ?? 0,
      isPlaying: data.is_playing === true,
      spotifyUrl: data.item.external_urls?.spotify,
      observedAtMs: Date.now(),
    }
  }

  private async getCurrentlyPlayingResponse() {
    const accessToken = await this.refreshAccessToken()

    return this.apiClient.get('/v1/me/player/currently-playing', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        market: this.config.market,
      },
    })
  }

  private async refreshAccessToken(forceRefresh = false): Promise<string> {
    const nowMs = Date.now()

    if (
      !forceRefresh &&
      this.accessToken &&
      this.accessTokenExpiresAtMs - TOKEN_REFRESH_SKEW_MS > nowMs
    ) {
      return this.accessToken
    }

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    )
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    })

    const response = await this.accountsClient.post<SpotifyTokenResponse>('/api/token', body, {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError('Spotify token refresh failed', response.status, '/api/token')
    }

    this.accessToken = response.data.access_token
    this.accessTokenExpiresAtMs = nowMs + response.data.expires_in * MILLISECONDS_PER_SECOND

    if (response.data.refresh_token) {
      this.refreshToken = response.data.refresh_token
    }

    return this.accessToken
  }
}
