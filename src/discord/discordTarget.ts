import { ConfigError } from '../errors'

const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,25}$/
const DISCORD_CHANNEL_URL_PATTERN =
  /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d{15,25})(?:\/.*)?$/i

export const normalizeDiscordChannelId = (value?: string): string | undefined => {
  if (!value) {
    return undefined
  }

  const trimmedValue = value.trim()
  const channelIdFromUrl = getDiscordChannelIdFromUrl(trimmedValue)

  if (channelIdFromUrl) {
    return channelIdFromUrl
  }

  if (!DISCORD_SNOWFLAKE_PATTERN.test(trimmedValue)) {
    throw new ConfigError(
      'Discord channel target must be a channel ID or a /channels/... Discord URL',
    )
  }

  return trimmedValue
}

export const normalizeDiscordDmRecipientId = (value?: string): string | undefined => {
  if (!value || getDiscordChannelIdFromUrl(value)) {
    return undefined
  }

  const trimmedValue = value.trim()

  if (!DISCORD_SNOWFLAKE_PATTERN.test(trimmedValue)) {
    throw new ConfigError('Discord DM target must be a user ID')
  }

  return trimmedValue
}

export const getDiscordChannelIdFromUrl = (value?: string): string | undefined => {
  if (!value) {
    return undefined
  }

  return DISCORD_CHANNEL_URL_PATTERN.exec(value.trim())?.[1]
}
