import type pino from 'pino'

import type { AppConfig } from './config'
import type { DiscordMessenger } from './discord/discordMessenger'
import type { LyricsDocument, LyricsProvider, SpotifyTrack, SyncedLyricLine } from './types'
import { formatTemplate } from './utils/template'
import type { TemplateValues } from './utils/template'
import type { DiscordMessageCommand } from './discord/discordMessenger'
import { toSafeLogError } from './utils/safeError'
import { sleep } from './utils/sleep'
import type { SpotifyClient } from './spotify/spotifyClient'

const MIN_SLEEP_MS = 50
const NO_NEXT_LINE_INDEX = 0
const STATUS_ENABLED_LABEL = 'enabled'
const STATUS_STOPPED_LABEL = 'stopped'

interface TrackSession {
  track: SpotifyTrack
  lyrics: LyricsDocument | null
  nextLineIndex: number
  lastProgressMs: number
  hasSentNoLyricsMessage: boolean
}

export class OwotifyRunner {
  private isStopping = false
  private isLyricStreamingEnabled = true
  private session: TrackSession | null = null

  constructor(
    private readonly config: AppConfig,
    private readonly logger: pino.Logger,
    private readonly spotifyClient: SpotifyClient,
    private readonly lyricsProvider: LyricsProvider,
    private readonly discordMessenger: DiscordMessenger,
  ) {}

  async start(): Promise<void> {
    this.logger.info('Starting owotify')
    this.discordMessenger.onCommand((command) => this.handleDiscordCommand(command))
    await this.discordMessenger.login()
    this.logger.info('Discord client connected')

    while (!this.isStopping) {
      const tickStartedAtMs = Date.now()

      try {
        await this.tick()
      } catch (error) {
        this.logger.error({ error: toSafeLogError(error) }, 'Owotify tick failed')
      }

      const elapsedMs = Date.now() - tickStartedAtMs
      await sleep(Math.max(MIN_SLEEP_MS, this.config.owotify.pollIntervalMs - elapsedMs))
    }
  }

  async stop(): Promise<void> {
    this.isStopping = true
    this.discordMessenger.destroy()
    this.logger.info('Owotify stopped')
  }

  private async tick(): Promise<void> {
    if (!this.isLyricStreamingEnabled) {
      return
    }

    const playback = await this.spotifyClient.getCurrentlyPlayingTrack()

    if (!playback || !playback.isPlaying) {
      this.session = null
      return
    }

    const session = await this.getOrCreateTrackSession(playback)
    const progressMs = this.getEstimatedProgressMs(playback)

    if (this.hasTrackRewound(session, progressMs)) {
      session.nextLineIndex = this.findNextLineIndex(session.lyrics?.syncedLines ?? [], progressMs)
    }

    session.track = playback
    session.lastProgressMs = progressMs

    await this.sendDueLyrics(session, progressMs)
  }

  private async getOrCreateTrackSession(track: SpotifyTrack): Promise<TrackSession> {
    if (this.session?.track.id === track.id) {
      return this.session
    }

    this.logger.info({ track: track.name, artists: track.artists }, 'Detected new Spotify track')
    const lyrics = await this.lyricsProvider.getLyricsForTrack(track)

    this.session = {
      track,
      lyrics,
      nextLineIndex: this.findNextLineIndex(lyrics?.syncedLines ?? [], track.progressMs),
      lastProgressMs: track.progressMs,
      hasSentNoLyricsMessage: false,
    }

    if (this.config.owotify.sendTrackHeader) {
      await this.discordMessenger.sendMessage(
        formatTemplate(this.config.owotify.trackHeaderTemplate, this.getTemplateValues(track, null)),
      )
    }

    await this.sendFallbackLyricsIfNeeded(this.session)
    return this.session
  }

  private async handleDiscordCommand(command: DiscordMessageCommand): Promise<void> {
    switch (command.name) {
      case 'start':
      case 'resume':
        await this.enableLyricStreaming()
        return
      case 'stop':
      case 'pause':
        await this.disableLyricStreaming()
        return
      case 'status':
        await this.sendStatus()
        return
      case 'skip':
      case 'reload':
        await this.reloadCurrentTrack()
        return
      case 'help':
      case 'commands':
        await this.sendCommandHelp()
        return
      case 'shutdown':
      case 'exit':
        await this.shutdownFromCommand()
        return
      default:
        await this.discordMessenger.sendMessage(
          `Unknown owotify command: ${command.name}. Try ${this.config.owotify.commandPrefix} help.`,
        )
    }
  }

  private async enableLyricStreaming(): Promise<void> {
    this.isLyricStreamingEnabled = true
    this.session = null
    await this.discordMessenger.sendMessage(
      'owotify lyric posting armed. Lyrics will start after Spotify reports active playback.',
    )
  }

  private async disableLyricStreaming(): Promise<void> {
    this.isLyricStreamingEnabled = false
    this.session = null
    await this.discordMessenger.sendMessage('owotify lyric posting stopped. Process is still online.')
  }

  private async reloadCurrentTrack(): Promise<void> {
    this.session = null
    await this.discordMessenger.sendMessage('owotify will reload the current track on the next poll.')
  }

  private async sendStatus(): Promise<void> {
    const status = this.isLyricStreamingEnabled ? STATUS_ENABLED_LABEL : STATUS_STOPPED_LABEL
    const track = this.session
      ? `${this.session.track.name} - ${this.session.track.artists.join(', ')}`
      : 'none'
    const syncedLineCount = this.session?.lyrics?.syncedLines.length ?? 0
    const nextLineIndex = this.session?.nextLineIndex ?? 0

    await this.discordMessenger.sendMessage(
      [
        `owotify status: ${status}`,
        `track: ${track}`,
        `synced lines: ${syncedLineCount}`,
        `next line: ${nextLineIndex}`,
      ].join('\n'),
    )
  }

  private async sendCommandHelp(): Promise<void> {
    const prefix = this.config.owotify.commandPrefix

    await this.discordMessenger.sendMessage(
      [
        'owotify commands:',
        `${prefix} start - start lyric posting`,
        `${prefix} stop - stop lyric posting but keep the process online`,
        `${prefix} status - show current state`,
        `${prefix} skip - reload the current track and lyrics`,
        `${prefix} help - show this command list`,
        `${prefix} shutdown - stop the process`,
      ].join('\n'),
    )
  }

  private async shutdownFromCommand(): Promise<void> {
    await this.discordMessenger.sendMessage('owotify shutting down.')
    await this.stop()
  }

  private async sendDueLyrics(session: TrackSession, progressMs: number): Promise<void> {
    const lines = session.lyrics?.syncedLines ?? []
    const dueWindowMs = progressMs + this.config.owotify.lyricLookaheadMs
    let sentLineCount = 0

    while (
      session.nextLineIndex < lines.length &&
      lines[session.nextLineIndex].timeMs <= dueWindowMs &&
      sentLineCount < this.config.owotify.maxLinesPerTick
    ) {
      const line = lines[session.nextLineIndex]
      session.nextLineIndex += 1

      if (line.text.trim().length === 0) {
        continue
      }

      await this.discordMessenger.sendMessage(
        formatTemplate(
          this.config.owotify.lyricLineTemplate,
          this.getTemplateValues(session.track, line),
        ),
      )
      sentLineCount += 1
    }
  }

  private async sendFallbackLyricsIfNeeded(session: TrackSession): Promise<void> {
    if (session.lyrics?.syncedLines.length) {
      return
    }

    const values = this.getTemplateValues(session.track, null, session.lyrics)

    if (session.lyrics?.plainLyrics && this.config.owotify.plainLyricsMode === 'once') {
      await this.discordMessenger.sendMessage(
        formatTemplate(this.config.owotify.plainLyricsTemplate, values),
      )
      session.hasSentNoLyricsMessage = true
      return
    }

    if (!this.config.owotify.sendNoLyricsMessage || session.hasSentNoLyricsMessage) {
      return
    }

    await this.discordMessenger.sendMessage(
      formatTemplate(this.config.owotify.noLyricsTemplate, values),
    )
    session.hasSentNoLyricsMessage = true
  }

  private hasTrackRewound(session: TrackSession, progressMs: number): boolean {
    return (
      progressMs + this.config.owotify.rewindResetThresholdMs < session.lastProgressMs &&
      session.nextLineIndex !== NO_NEXT_LINE_INDEX
    )
  }

  private findNextLineIndex(lines: SyncedLyricLine[], progressMs: number): number {
    const index = lines.findIndex((line) => line.timeMs >= progressMs)

    if (index === -1) {
      return lines.length
    }

    return index
  }

  private getEstimatedProgressMs(track: SpotifyTrack): number {
    const elapsedSinceObservationMs = Date.now() - track.observedAtMs
    return Math.min(track.durationMs, track.progressMs + elapsedSinceObservationMs)
  }

  private getTemplateValues(
    track: SpotifyTrack,
    line: SyncedLyricLine | null,
    lyrics: LyricsDocument | null = this.session?.lyrics ?? null,
  ): TemplateValues {
    return {
      album: track.albumName,
      artist: track.artists.join(', '),
      artists: track.artists.join(', '),
      durationMs: track.durationMs,
      line: line?.text,
      plainLyrics: lyrics?.plainLyrics,
      progressMs: track.progressMs,
      spotifyUrl: track.spotifyUrl,
      timeMs: line?.timeMs,
      track: track.name,
    }
  }
}
