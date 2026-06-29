import { describe, expect, it } from 'vitest'

import {
  getDiscordChannelIdFromUrl,
  normalizeDiscordChannelId,
  normalizeDiscordDmRecipientId,
} from '../src/discord/discordTarget'
import { ConfigError } from '../src/errors'

describe('discord target helpers', () => {
  it('normalizes channel IDs', () => {
    expect(normalizeDiscordChannelId('1521022683905523834')).toBe('1521022683905523834')
  })

  it('extracts channel IDs from Discord URLs', () => {
    expect(getDiscordChannelIdFromUrl('https://discord.com/channels/@me/1521022683905523834')).toBe(
      '1521022683905523834',
    )
  })

  it('ignores Discord channel URLs as DM recipient IDs', () => {
    expect(
      normalizeDiscordDmRecipientId('https://discord.com/channels/@me/1521022683905523834'),
    ).toBeUndefined()
  })

  it('rejects invalid channel targets', () => {
    expect(() => normalizeDiscordChannelId('not-a-channel')).toThrow(ConfigError)
  })
})
