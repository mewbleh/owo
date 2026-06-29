import { loadConfig } from './config'
import { DiscordMessenger } from './discord/discordMessenger'
import { LrclibClient } from './lyrics/lrclibClient'
import { createLogger } from './logger'
import { OwotifyRunner } from './owotifyRunner'
import { SpotifyClient } from './spotify/spotifyClient'

const main = async (): Promise<void> => {
  const config = loadConfig()
  const logger = createLogger(config)
  const spotifyClient = new SpotifyClient(config.spotify)
  const lyricsProvider = new LrclibClient({
    baseUrl: config.lyrics.lrclibBaseUrl,
  })
  const discordMessenger = new DiscordMessenger({
    token: config.discord.token,
    channelId: config.discord.channelId,
    apiBaseUrl: config.discord.apiBaseUrl,
    gatewayUrl: config.discord.gatewayUrl,
    gatewayEnabled: config.discord.gatewayEnabled,
    minMessageIntervalMs: config.owotify.minMessageIntervalMs,
    maxMessageLength: config.owotify.maxMessageLength,
  })
  const runner = new OwotifyRunner(
    config,
    logger,
    spotifyClient,
    lyricsProvider,
    discordMessenger,
  )

  process.once('SIGINT', () => {
    void runner.stop()
  })
  process.once('SIGTERM', () => {
    void runner.stop()
  })

  await runner.start()
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
