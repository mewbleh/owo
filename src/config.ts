import 'dotenv/config'

import { z } from 'zod'

import { ConfigError } from './errors'

const DEFAULT_LOG_LEVEL = 'info'
const DEFAULT_SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:4377/callback'
const DEFAULT_LRCLIB_BASE_URL = 'https://lrclib.net'
const DEFAULT_DISCORD_API_BASE_URL = 'https://discord.com/api/v10'
const DEFAULT_DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'
const DISCORD_INTENT_GUILDS = 1 << 0
const DISCORD_INTENT_GUILD_MESSAGES = 1 << 9
const DISCORD_INTENT_DIRECT_MESSAGES = 1 << 12
const DISCORD_INTENT_MESSAGE_CONTENT = 1 << 15
const DEFAULT_DISCORD_GATEWAY_INTENTS =
  DISCORD_INTENT_GUILDS |
  DISCORD_INTENT_GUILD_MESSAGES |
  DISCORD_INTENT_DIRECT_MESSAGES |
  DISCORD_INTENT_MESSAGE_CONTENT
const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_LYRIC_LOOKAHEAD_MS = 350
const DEFAULT_REWIND_RESET_THRESHOLD_MS = 3000
const DEFAULT_MIN_MESSAGE_INTERVAL_MS = 1100
const DEFAULT_MAX_LINES_PER_TICK = 4
const DEFAULT_MAX_MESSAGE_LENGTH = 1900
const DEFAULT_COMMAND_PREFIX = '!owo'
const DEFAULT_TRACK_HEADER_TEMPLATE = 'Now playing: {track} - {artist}'
const DEFAULT_LYRIC_LINE_TEMPLATE = '{line}'
const DEFAULT_NO_LYRICS_TEMPLATE = 'No synced lyrics found for {track} - {artist}.'
const DEFAULT_PLAIN_LYRICS_TEMPLATE = '{plainLyrics}'
const MIN_POLL_INTERVAL_MS = 500
const MIN_MESSAGE_INTERVAL_MS = 250
const MIN_MAX_MESSAGE_LENGTH = 100
const MAX_DISCORD_MESSAGE_LENGTH = 2000
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

export type PlainLyricsMode = 'off' | 'once'
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface AppConfig {
  discord: {
    token: string
    channelId?: string
    dmRecipientId?: string
    apiBaseUrl: string
    gatewayUrl: string
    gatewayEnabled: boolean
    gatewayIntents: number
  }
  spotify: {
    clientId: string
    clientSecret: string
    refreshToken: string
    market?: string
    redirectUri: string
  }
  lyrics: {
    lrclibBaseUrl: string
  }
  owotify: {
    logLevel: LogLevel
    pollIntervalMs: number
    lyricLookaheadMs: number
    rewindResetThresholdMs: number
    minMessageIntervalMs: number
    maxLinesPerTick: number
    maxMessageLength: number
    commandsEnabled: boolean
    commandPrefix: string
    sendTrackHeader: boolean
    trackHeaderTemplate: string
    lyricLineTemplate: string
    noLyricsTemplate: string
    plainLyricsMode: PlainLyricsMode
    plainLyricsTemplate: string
    sendNoLyricsMessage: boolean
  }
}

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined
  }

  return value
}

const stringFromEnv = z.preprocess(emptyStringToUndefined, z.string().min(1))
const optionalStringFromEnv = z.preprocess(emptyStringToUndefined, z.string().min(1).optional())

const integerFromEnv = (defaultValue: number, minValue: number, maxValue = Number.MAX_SAFE_INTEGER) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue
    }

    return Number(value)
  }, z.number().int().min(minValue).max(maxValue))

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue
    }

    if (typeof value === 'boolean') {
      return value
    }

    const normalizedValue = String(value).trim().toLowerCase()

    if (TRUE_VALUES.has(normalizedValue)) {
      return true
    }

    if (FALSE_VALUES.has(normalizedValue)) {
      return false
    }

    return value
  }, z.boolean())

const envSchema = z.object({
  DISCORD_TOKEN: stringFromEnv,
  DISCORD_CHANNEL_ID: optionalStringFromEnv,
  DISCORD_DM_RECIPIENT_ID: optionalStringFromEnv,
  DISCORD_API_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().url().optional())
    .default(DEFAULT_DISCORD_API_BASE_URL),
  DISCORD_GATEWAY_URL: z
    .preprocess(emptyStringToUndefined, z.string().url().optional())
    .default(DEFAULT_DISCORD_GATEWAY_URL),
  DISCORD_GATEWAY_ENABLED: booleanFromEnv(true),
  DISCORD_GATEWAY_INTENTS: integerFromEnv(DEFAULT_DISCORD_GATEWAY_INTENTS, 0),
  SPOTIFY_CLIENT_ID: stringFromEnv,
  SPOTIFY_CLIENT_SECRET: stringFromEnv,
  SPOTIFY_REFRESH_TOKEN: stringFromEnv,
  SPOTIFY_MARKET: optionalStringFromEnv,
  SPOTIFY_REDIRECT_URI: z
    .preprocess(emptyStringToUndefined, z.string().url().optional())
    .default(DEFAULT_SPOTIFY_REDIRECT_URI),
  LRCLIB_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().url().optional())
    .default(DEFAULT_LRCLIB_BASE_URL),
  OWOTIFY_LOG_LEVEL: z
    .preprocess(emptyStringToUndefined, z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional())
    .default(DEFAULT_LOG_LEVEL),
  OWOTIFY_POLL_INTERVAL_MS: integerFromEnv(DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS),
  OWOTIFY_LYRIC_LOOKAHEAD_MS: integerFromEnv(DEFAULT_LYRIC_LOOKAHEAD_MS, 0),
  OWOTIFY_REWIND_RESET_THRESHOLD_MS: integerFromEnv(DEFAULT_REWIND_RESET_THRESHOLD_MS, 0),
  OWOTIFY_MIN_MESSAGE_INTERVAL_MS: integerFromEnv(
    DEFAULT_MIN_MESSAGE_INTERVAL_MS,
    MIN_MESSAGE_INTERVAL_MS,
  ),
  OWOTIFY_MAX_LINES_PER_TICK: integerFromEnv(DEFAULT_MAX_LINES_PER_TICK, 1),
  OWOTIFY_MAX_MESSAGE_LENGTH: integerFromEnv(
    DEFAULT_MAX_MESSAGE_LENGTH,
    MIN_MAX_MESSAGE_LENGTH,
    MAX_DISCORD_MESSAGE_LENGTH,
  ),
  OWOTIFY_COMMANDS_ENABLED: booleanFromEnv(true),
  OWOTIFY_COMMAND_PREFIX: z
    .preprocess(emptyStringToUndefined, z.string().min(1).optional())
    .default(DEFAULT_COMMAND_PREFIX),
  OWOTIFY_SEND_TRACK_HEADER: booleanFromEnv(true),
  OWOTIFY_TRACK_HEADER_TEMPLATE: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default(DEFAULT_TRACK_HEADER_TEMPLATE),
  OWOTIFY_LYRIC_LINE_TEMPLATE: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default(DEFAULT_LYRIC_LINE_TEMPLATE),
  OWOTIFY_NO_LYRICS_TEMPLATE: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default(DEFAULT_NO_LYRICS_TEMPLATE),
  OWOTIFY_PLAIN_LYRICS_MODE: z
    .preprocess(emptyStringToUndefined, z.enum(['off', 'once']).optional())
    .default('off'),
  OWOTIFY_PLAIN_LYRICS_TEMPLATE: z
    .preprocess(emptyStringToUndefined, z.string().optional())
    .default(DEFAULT_PLAIN_LYRICS_TEMPLATE),
  OWOTIFY_SEND_NO_LYRICS_MESSAGE: booleanFromEnv(true),
})

export const loadConfig = (): AppConfig => {
  const parsedEnv = envSchema.safeParse(process.env)

  if (!parsedEnv.success) {
    const details = parsedEnv.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new ConfigError(`Invalid environment configuration:\n${details}`)
  }

  const env = parsedEnv.data

  if (!env.DISCORD_CHANNEL_ID && !env.DISCORD_DM_RECIPIENT_ID) {
    throw new ConfigError('Either DISCORD_CHANNEL_ID or DISCORD_DM_RECIPIENT_ID is required')
  }

  return {
    discord: {
      token: env.DISCORD_TOKEN,
      channelId: env.DISCORD_CHANNEL_ID,
      dmRecipientId: env.DISCORD_DM_RECIPIENT_ID,
      apiBaseUrl: env.DISCORD_API_BASE_URL,
      gatewayUrl: env.DISCORD_GATEWAY_URL,
      gatewayEnabled: env.DISCORD_GATEWAY_ENABLED,
      gatewayIntents: env.DISCORD_GATEWAY_INTENTS,
    },
    spotify: {
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      refreshToken: env.SPOTIFY_REFRESH_TOKEN,
      market: env.SPOTIFY_MARKET,
      redirectUri: env.SPOTIFY_REDIRECT_URI,
    },
    lyrics: {
      lrclibBaseUrl: env.LRCLIB_BASE_URL,
    },
    owotify: {
      logLevel: env.OWOTIFY_LOG_LEVEL as LogLevel,
      pollIntervalMs: env.OWOTIFY_POLL_INTERVAL_MS,
      lyricLookaheadMs: env.OWOTIFY_LYRIC_LOOKAHEAD_MS,
      rewindResetThresholdMs: env.OWOTIFY_REWIND_RESET_THRESHOLD_MS,
      minMessageIntervalMs: env.OWOTIFY_MIN_MESSAGE_INTERVAL_MS,
      maxLinesPerTick: env.OWOTIFY_MAX_LINES_PER_TICK,
      maxMessageLength: env.OWOTIFY_MAX_MESSAGE_LENGTH,
      commandsEnabled: env.OWOTIFY_COMMANDS_ENABLED,
      commandPrefix: env.OWOTIFY_COMMAND_PREFIX,
      sendTrackHeader: env.OWOTIFY_SEND_TRACK_HEADER,
      trackHeaderTemplate: env.OWOTIFY_TRACK_HEADER_TEMPLATE,
      lyricLineTemplate: env.OWOTIFY_LYRIC_LINE_TEMPLATE,
      noLyricsTemplate: env.OWOTIFY_NO_LYRICS_TEMPLATE,
      plainLyricsMode: env.OWOTIFY_PLAIN_LYRICS_MODE as PlainLyricsMode,
      plainLyricsTemplate: env.OWOTIFY_PLAIN_LYRICS_TEMPLATE,
      sendNoLyricsMessage: env.OWOTIFY_SEND_NO_LYRICS_MESSAGE,
    },
  }
}
