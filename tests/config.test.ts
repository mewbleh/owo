import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config'
import { ConfigError } from '../src/errors'

const REQUIRED_ENV = {
  DISCORD_TOKEN: 'discord-token',
  SPOTIFY_CLIENT_ID: 'spotify-client-id',
  SPOTIFY_CLIENT_SECRET: 'spotify-client-secret',
  SPOTIFY_REFRESH_TOKEN: 'spotify-refresh-token',
}

const loadConfigWithEnv = (env: NodeJS.ProcessEnv) => {
  const originalEnv = process.env

  process.env = {
    ...originalEnv,
    ...REQUIRED_ENV,
    ...env,
  }

  try {
    return loadConfig()
  } finally {
    process.env = originalEnv
  }
}

describe('loadConfig', () => {
  it('uses a DM recipient when the Discord channel ID is empty', () => {
    const config = loadConfigWithEnv({
      DISCORD_CHANNEL_ID: '',
      DISCORD_DM_RECIPIENT_ID: '123456789012345678',
    })

    expect(config.discord.channelId).toBeUndefined()
    expect(config.discord.dmRecipientId).toBe('123456789012345678')
  })

  it('defaults lyric posting to manual start mode', () => {
    const config = loadConfigWithEnv({
      DISCORD_CHANNEL_ID: '1521022683905523834',
      DISCORD_DM_RECIPIENT_ID: '',
    })

    expect(config.owotify.autoStart).toBe(false)
  })

  it('loads status output mode configuration', () => {
    const config = loadConfigWithEnv({
      DISCORD_CHANNEL_ID: '1521022683905523834',
      OWOTIFY_OUTPUT_MODE: 'status',
      OWOTIFY_PRESENCE_STATUS: 'idle',
      OWOTIFY_STATUS_TEMPLATE: 'music {line}',
    })

    expect(config.owotify.outputMode).toBe('status')
    expect(config.owotify.presenceStatus).toBe('idle')
    expect(config.owotify.statusTemplate).toBe('music {line}')
  })

  it('extracts a DM channel ID from a Discord channel URL', () => {
    const config = loadConfigWithEnv({
      DISCORD_CHANNEL_ID: 'https://discord.com/channels/@me/1521022683905523834',
      DISCORD_DM_RECIPIENT_ID: '',
    })

    expect(config.discord.channelId).toBe('1521022683905523834')
    expect(config.discord.dmRecipientId).toBeUndefined()
  })

  it('treats a Discord channel URL in the DM recipient slot as a channel target', () => {
    const config = loadConfigWithEnv({
      DISCORD_CHANNEL_ID: '',
      DISCORD_DM_RECIPIENT_ID: 'https://discord.com/channels/@me/1521022683905523834',
    })

    expect(config.discord.channelId).toBe('1521022683905523834')
    expect(config.discord.dmRecipientId).toBeUndefined()
  })

  it('requires either a Discord channel ID or DM recipient ID', () => {
    expect(() =>
      loadConfigWithEnv({
        DISCORD_CHANNEL_ID: '',
        DISCORD_DM_RECIPIENT_ID: '',
      }),
    ).toThrow(ConfigError)
  })
})
