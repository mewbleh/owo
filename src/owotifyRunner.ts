import type pino from 'pino'

import type { AppConfig } from './config'
import type { OutputMode } from './config'
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
const OUTPUT_MODE_MESSAGE = 'message'
const OUTPUT_MODE_STATUS = 'status'
const OUTPUT_MODE_BOTH = 'both'

interface TrackSession {
  track: SpotifyTrack
  lyrics: LyricsDocument | null
  nextLineIndex: number
  lastProgressMs: number
  hasSentNoLyricsMessage: boolean
}

export class OwotifyRunner {
  private isStopping = false
  private isLyricStreamingEnabled: boolean
  private outputMode: OutputMode
  private session: TrackSession | null = null

  constructor(
    private readonly config: AppConfig,
    private readonly logger: pino.Logger,
    private readonly spotifyClient: SpotifyClient,
    private readonly lyricsProvider: LyricsProvider,
    private readonly discordMessenger: DiscordMessenger,
  ) {
    this.isLyricStreamingEnabled = config.owotify.autoStart
    this.outputMode = config.owotify.outputMode
  }

  async start(): Promise<void> {
    this.logger.info('Starting owotify')
    if (this.usesStatusMode() && !this.config.discord.gatewayEnabled) {
      throw new Error('Status output mode requires DISCORD_GATEWAY_ENABLED=true')
    }

    this.discordMessenger.onCommand((command) => this.handleDiscordCommand(command))
    await this.discordMessenger.login()
    this.updateIdleStatus()
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
      this.updateIdleStatus()
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
      const values = this.getTemplateValues(track, null)

      if (this.sendsMessages()) {
        await this.discordMessenger.sendMessage(
          formatTemplate(this.config.owotify.trackHeaderTemplate, values),
        )
      }

      this.updateStatusFromTemplate(this.config.owotify.trackHeaderTemplate, values)
    }

    await this.sendFallbackLyricsIfNeeded(this.session)
    return this.session
  }

  private async handleDiscordCommand(command: DiscordMessageCommand): Promise<void> {
    switch (command.name) {
      case 'start':
      case 'resume':
        await this.enableLyricStreaming(command)
        return
      case 'stop':
      case 'pause':
        await this.disableLyricStreaming(command)
        return
      case 'status':
        await this.sendStatus(command)
        return
      case 'mode':
      case 'output':
        await this.handleModeCommand(command, command.args[0])
        return
      case 'target':
      case 'channel':
      case 'dm':
        await this.handleTargetCommand(command)
        return
      case 'skip':
      case 'reload':
        await this.reloadCurrentTrack(command)
        return
      case 'help':
      case 'commands':
        await this.sendCommandHelp(command)
        return
      case 'shutdown':
      case 'exit':
        await this.shutdownFromCommand(command)
        return
      default:
        await this.replyToCommand(
          command,
          `Unknown owotify command: ${command.name}. Try ${this.config.owotify.commandPrefix} help.`,
        )
    }
  }

  private async enableLyricStreaming(command: DiscordMessageCommand): Promise<void> {
    this.isLyricStreamingEnabled = true
    this.session = null
    await this.replyToCommand(
      command,
      'owotify lyric posting armed. Lyrics will start after Spotify reports active playback.',
    )
  }

  private async disableLyricStreaming(command: DiscordMessageCommand): Promise<void> {
    this.isLyricStreamingEnabled = false
    this.session = null
    this.updateIdleStatus()
    await this.replyToCommand(command, 'owotify lyric posting stopped. Process is still online.')
  }

  private async reloadCurrentTrack(command: DiscordMessageCommand): Promise<void> {
    this.session = null
    await this.replyToCommand(command, 'owotify will reload the current track on the next poll.')
  }

  private async sendStatus(command: DiscordMessageCommand): Promise<void> {
    const status = this.isLyricStreamingEnabled ? STATUS_ENABLED_LABEL : STATUS_STOPPED_LABEL
    const track = this.session
      ? `${this.session.track.name} - ${this.session.track.artists.join(', ')}`
      : 'none'
    const syncedLineCount = this.session?.lyrics?.syncedLines.length ?? 0
    const nextLineIndex = this.session?.nextLineIndex ?? 0

    await this.replyToCommand(
      command,
      [
        `owotify status: ${status}`,
        `output mode: ${this.outputMode}`,
        `target: ${this.discordMessenger.getTargetSummary()}`,
        `track: ${track}`,
        `synced lines: ${syncedLineCount}`,
        `next line: ${nextLineIndex}`,
      ].join('\n'),
    )
  }

  private async handleModeCommand(command: DiscordMessageCommand, mode?: string): Promise<void> {
    if (!mode) {
      await this.replyToCommand(command, `owotify output mode: ${this.outputMode}`)
      return
    }

    if (!this.isOutputMode(mode)) {
      await this.replyToCommand(command, 'Unknown mode. Use message, status, or both.')
      return
    }

    if ((mode === OUTPUT_MODE_STATUS || mode === OUTPUT_MODE_BOTH) && !this.config.discord.gatewayEnabled) {
      await this.replyToCommand(command, 'Status mode requires DISCORD_GATEWAY_ENABLED=true.')
      return
    }

    this.outputMode = mode
    this.session = null
    this.updateIdleStatus()
    await this.replyToCommand(command, `owotify output mode set to ${mode}.`)
  }

  private async handleTargetCommand(command: DiscordMessageCommand): Promise<void> {
    const [subcommand = 'show', targetValue] =
      command.name === 'target' ? command.args : [command.name, command.args[0]]

    try {
      switch (subcommand) {
        case 'show':
        case 'status':
          await this.replyToCommand(command, `owotify target: ${this.discordMessenger.getTargetSummary()}`)
          return
        case 'here':
          await this.discordMessenger.setTargetChannel(command.channelId)
          await this.replyToCommand(command, `owotify target set to this channel: ${command.channelId}`)
          return
        case 'channel':
          if (!targetValue) {
            await this.replyToCommand(command, 'Usage: owo target channel <channel_id_or_url>')
            return
          }

          await this.discordMessenger.setTargetChannel(targetValue)
          await this.replyToCommand(command, `owotify target set to ${this.discordMessenger.getTargetSummary()}`)
          return
        case 'dm':
          if (!targetValue) {
            await this.replyToCommand(command, 'Usage: owo target dm <user_id>')
            return
          }

          await this.discordMessenger.setTargetDmRecipient(targetValue)
          await this.replyToCommand(command, `owotify target set to ${this.discordMessenger.getTargetSummary()}`)
          return
        case 'reset':
        case 'env':
          await this.discordMessenger.resetTarget()
          await this.replyToCommand(
            command,
            `owotify target reset to ${this.discordMessenger.getTargetSummary()}`,
          )
          return
        default:
          await this.replyToCommand(
            command,
            'Unknown target command. Use: owo target show|here|channel <id/url>|dm <user_id>|reset',
          )
      }
    } catch (error) {
      const safeError = toSafeLogError(error)
      await this.replyToCommand(command, `Failed to update target: ${safeError.message}`)
    }
  }

  private async sendCommandHelp(command: DiscordMessageCommand): Promise<void> {
    const prefix = this.config.owotify.commandPrefix

    await this.replyToCommand(
      command,
      [
        'owotify commands:',
        `${prefix} start - start lyric posting`,
        `${prefix} stop - stop lyric posting but keep the process online`,
        `${prefix} status - show current state`,
        `${prefix} mode message|status|both - choose chat messages, Discord status, or both`,
        `${prefix} target show - show the current output target`,
        `${prefix} target here - send output to this channel or DM`,
        `${prefix} target channel <id/url> - send output to a channel or DM channel`,
        `${prefix} target dm <user_id> - create/reuse a DM and send output there`,
        `${prefix} target reset - reset output target to .env`,
        `${prefix} skip - reload the current track and lyrics`,
        `${prefix} help - show this command list`,
        `${prefix} shutdown - stop the process`,
      ].join('\n'),
    )
  }

  private async shutdownFromCommand(command: DiscordMessageCommand): Promise<void> {
    await this.replyToCommand(command, 'owotify shutting down.')
    this.discordMessenger.clearCustomStatus(this.config.owotify.presenceStatus)
    await this.stop()
  }

  private async replyToCommand(command: DiscordMessageCommand, content: string): Promise<void> {
    await this.discordMessenger.sendMessageToChannel(command.channelId, content)
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

      const templateValues = this.getTemplateValues(session.track, line)

      if (this.sendsMessages()) {
        await this.discordMessenger.sendMessage(
          formatTemplate(this.config.owotify.lyricLineTemplate, templateValues),
        )
      }

      if (this.updatesStatus()) {
        this.discordMessenger.updateCustomStatus(
          formatTemplate(this.config.owotify.statusTemplate, templateValues),
          this.config.owotify.presenceStatus,
        )
      }
      sentLineCount += 1
    }
  }

  private async sendFallbackLyricsIfNeeded(session: TrackSession): Promise<void> {
    if (session.lyrics?.syncedLines.length) {
      return
    }

    const values = this.getTemplateValues(session.track, null, session.lyrics)

    if (session.lyrics?.plainLyrics && this.config.owotify.plainLyricsMode === 'once') {
      if (this.sendsMessages()) {
        await this.discordMessenger.sendMessage(
          formatTemplate(this.config.owotify.plainLyricsTemplate, values),
        )
      }
      this.updateStatusFromTemplate(this.config.owotify.noLyricsTemplate, values)
      session.hasSentNoLyricsMessage = true
      return
    }

    if (!this.config.owotify.sendNoLyricsMessage || session.hasSentNoLyricsMessage) {
      return
    }

    if (this.sendsMessages()) {
      await this.discordMessenger.sendMessage(
        formatTemplate(this.config.owotify.noLyricsTemplate, values),
      )
    }
    this.updateStatusFromTemplate(this.config.owotify.noLyricsTemplate, values)
    session.hasSentNoLyricsMessage = true
  }

  private sendsMessages(): boolean {
    return this.outputMode === OUTPUT_MODE_MESSAGE || this.outputMode === OUTPUT_MODE_BOTH
  }

  private updatesStatus(): boolean {
    return this.outputMode === OUTPUT_MODE_STATUS || this.outputMode === OUTPUT_MODE_BOTH
  }

  private usesStatusMode(): boolean {
    return this.config.owotify.outputMode === OUTPUT_MODE_STATUS || this.config.owotify.outputMode === OUTPUT_MODE_BOTH
  }

  private isOutputMode(mode: string): mode is OutputMode {
    return mode === OUTPUT_MODE_MESSAGE || mode === OUTPUT_MODE_STATUS || mode === OUTPUT_MODE_BOTH
  }

  private updateIdleStatus(): void {
    if (!this.updatesStatus()) {
      return
    }

    this.discordMessenger.updateCustomStatus(
      this.config.owotify.statusIdleTemplate,
      this.config.owotify.presenceStatus,
    )
  }

  private updateStatusFromTemplate(template: string, values: TemplateValues): void {
    if (!this.updatesStatus()) {
      return
    }

    this.discordMessenger.updateCustomStatus(
      formatTemplate(template, values),
      this.config.owotify.presenceStatus,
    )
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
