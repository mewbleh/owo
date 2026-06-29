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

  it('requires either a Discord channel ID or DM recipient ID', () => {
    expect(() =>
      loadConfigWithEnv({
        DISCORD_CHANNEL_ID: '',
        DISCORD_DM_RECIPIENT_ID: '',
      }),
    ).toThrow(ConfigError)
  })
})
