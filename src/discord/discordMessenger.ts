import axios from 'axios'
import type { AxiosInstance } from 'axios'
import WebSocket from 'ws'

import { HttpRequestError } from '../errors'
import { parseDiscordCommand } from './commandParser'
import type { DiscordCommand } from './commandParser'
import { normalizeDiscordChannelId, normalizeDiscordDmRecipientId } from './discordTarget'
import { splitMessage } from '../utils/message'
import { toSafeLogError } from '../utils/safeError'
import { sleep } from '../utils/sleep'

const DISCORD_USER_AGENT = 'owotify/1.0.0'
const READY_TIMEOUT_MS = 30_000
const MIN_WAIT_MS = 0
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 299
const RATE_LIMIT_STATUS = 429
const BAD_REQUEST_STATUS = 400
const MAX_REST_RETRIES = 3
const RATE_LIMIT_FALLBACK_MS = 1000
const MAX_ERROR_DETAIL_LENGTH = 500
const MAX_RECENT_SENT_MESSAGE_IDS = 100
const MILLISECONDS_PER_SECOND = 1000
const WEBSOCKET_NORMAL_CLOSE_CODE = 1000
// ref: https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-opcodes
const GATEWAY_OPCODE_DISPATCH = 0
const GATEWAY_OPCODE_HEARTBEAT = 1
const GATEWAY_OPCODE_PRESENCE_UPDATE = 3
const GATEWAY_OPCODE_IDENTIFY = 2
const GATEWAY_OPCODE_HELLO = 10
const GATEWAY_READY_EVENT = 'READY'
const GATEWAY_MESSAGE_CREATE_EVENT = 'MESSAGE_CREATE'
const CUSTOM_STATUS_ACTIVITY_TYPE = 4
const MAX_CUSTOM_STATUS_LENGTH = 128

export type DiscordPresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible'

interface DiscordMessengerConfig {
  token: string
  channelId?: string
  dmRecipientId?: string
  apiBaseUrl: string
  gatewayUrl: string
  gatewayEnabled: boolean
  gatewayIntents: number
  commandsEnabled: boolean
  commandPrefix: string
  minMessageIntervalMs: number
  maxMessageLength: number
}

interface DiscordTargetState {
  channelId: string
  label: string
  source: 'env' | 'override'
}

export interface DiscordMessageCommand extends DiscordCommand {
  authorId: string
  channelId: string
  messageId: string
}

type DiscordMessageCommandHandler = (command: DiscordMessageCommand) => Promise<void> | void

interface DiscordUserResponse {
  id: string
  username: string
}

interface DiscordDmChannelResponse {
  id: string
}

interface DiscordCreateMessageResponse {
  id: string
}

interface DiscordErrorResponse {
  code?: number
  message?: string
  errors?: unknown
}

interface DiscordRateLimitResponse {
  retry_after?: number
}

interface GatewayPayload<TData = unknown> {
  op: number
  d: TData
  s: number | null
  t: string | null
}

interface GatewayHelloData {
  heartbeat_interval: number
}

interface GatewayReadyData {
  user: DiscordUserResponse
}

interface GatewayMessageCreateData {
  id: string
  channel_id: string
  content: string
  author: {
    id: string
    username?: string
  }
}

interface GatewayIdentifyData {
  token: string
  intents: number
  properties: {
    os: string
    browser: string
    device: string
  }
}

interface GatewayPresenceUpdateData {
  since: number | null
  activities: Array<{
    name: string
    type: number
    state?: string
  }>
  status: DiscordPresenceStatus
  afk: boolean
}

export class DiscordMessenger {
  private readonly restClient: AxiosInstance
  private gatewaySocket: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private sequence: number | null = null
  private selfUserId: string | null = null
  private targetChannelId: string | null = null
  private targetState: DiscordTargetState | null = null
  private commandHandler: DiscordMessageCommandHandler | null = null
  private readonly sentMessageIds = new Set<string>()
  private lastPresenceKey: string | null = null
  private lastMessageAtMs = 0
  private isConnected = false

  constructor(private readonly config: DiscordMessengerConfig) {
    this.restClient = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        Authorization: config.token,
        'Content-Type': 'application/json',
        'User-Agent': DISCORD_USER_AGENT,
      },
      validateStatus: () => true,
    })
  }

  onCommand(handler: DiscordMessageCommandHandler): void {
    this.commandHandler = handler
  }

  async login(): Promise<void> {
    if (this.config.commandsEnabled && !this.config.gatewayEnabled) {
      throw new Error('Discord commands require DISCORD_GATEWAY_ENABLED=true')
    }

    await this.validateToken()
    await this.resolveTargetChannel()

    if (this.config.gatewayEnabled) {
      await this.connectGateway()
    }

    this.isConnected = true
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Discord messenger is not connected')
    }

    const chunks = splitMessage(content, this.config.maxMessageLength)

    for (const chunk of chunks) {
      await this.waitForMessageWindow()
      await this.createMessage(this.getRequiredTargetChannelId(), chunk)
      this.lastMessageAtMs = Date.now()
    }
  }

  async sendMessageToChannel(channelId: string, content: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Discord messenger is not connected')
    }

    const chunks = splitMessage(content, this.config.maxMessageLength)

    for (const chunk of chunks) {
      await this.waitForMessageWindow()
      await this.createMessage(channelId, chunk)
      this.lastMessageAtMs = Date.now()
    }
  }

  getTargetSummary(): string {
    return this.targetState?.label ?? 'unresolved'
  }

  async setTargetChannel(channelIdOrUrl: string): Promise<string> {
    const channelId = normalizeDiscordChannelId(channelIdOrUrl)

    if (!channelId) {
      throw new Error('Target channel cannot be empty')
    }

    this.setTargetState({
      channelId,
      label: `channel ${channelId} (override)`,
      source: 'override',
    })

    return this.getTargetSummary()
  }

  async setTargetDmRecipient(recipientId: string): Promise<string> {
    const normalizedRecipientId = normalizeDiscordDmRecipientId(recipientId)

    if (!normalizedRecipientId) {
      throw new Error('Target DM recipient must be a user ID')
    }

    const channelId = await this.createDmChannel(normalizedRecipientId)

    this.setTargetState({
      channelId,
      label: `dm user ${normalizedRecipientId} -> channel ${channelId} (override)`,
      source: 'override',
    })

    return this.getTargetSummary()
  }

  async resetTarget(): Promise<string> {
    await this.resolveTargetChannel()
    return this.getTargetSummary()
  }

  updateCustomStatus(statusText: string, status: DiscordPresenceStatus): void {
    const trimmedStatusText = statusText.trim().slice(0, MAX_CUSTOM_STATUS_LENGTH)

    if (trimmedStatusText.length === 0) {
      this.clearCustomStatus(status)
      return
    }

    const presenceKey = `${status}:${trimmedStatusText}`

    if (this.lastPresenceKey === presenceKey) {
      return
    }

    this.lastPresenceKey = presenceKey

    // ref: https://discord.com/developers/docs/events/gateway-events#update-presence
    this.sendGatewayPayload<GatewayPresenceUpdateData>({
      op: GATEWAY_OPCODE_PRESENCE_UPDATE,
      d: {
        since: null,
        activities: [
          {
            name: 'Custom Status',
            type: CUSTOM_STATUS_ACTIVITY_TYPE,
            state: trimmedStatusText,
          },
        ],
        status,
        afk: false,
      },
      s: null,
      t: null,
    })
  }

  clearCustomStatus(status: DiscordPresenceStatus): void {
    const presenceKey = `${status}:`

    if (this.lastPresenceKey === presenceKey) {
      return
    }

    this.lastPresenceKey = presenceKey

    this.sendGatewayPayload<GatewayPresenceUpdateData>({
      op: GATEWAY_OPCODE_PRESENCE_UPDATE,
      d: {
        since: null,
        activities: [],
        status,
        afk: false,
      },
      s: null,
      t: null,
    })
  }

  destroy(): void {
    this.isConnected = false

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.gatewaySocket) {
      this.gatewaySocket.close(WEBSOCKET_NORMAL_CLOSE_CODE, 'owotify stopped')
      this.gatewaySocket = null
    }
  }

  private async validateToken(): Promise<void> {
    const response = await this.restClient.get<DiscordUserResponse>('/users/@me')

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError('Discord token validation failed', response.status, '/users/@me')
    }

    this.selfUserId = response.data.id
  }

  private async resolveTargetChannel(): Promise<void> {
    if (this.config.channelId) {
      this.setTargetState({
        channelId: this.config.channelId,
        label: `channel ${this.config.channelId} (env)`,
        source: 'env',
      })
      return
    }

    if (this.config.dmRecipientId) {
      const channelId = await this.createDmChannel(this.config.dmRecipientId)

      this.setTargetState({
        channelId,
        label: `dm user ${this.config.dmRecipientId} -> channel ${channelId} (env)`,
        source: 'env',
      })
      return
    }

    throw new Error('Either DISCORD_CHANNEL_ID or DISCORD_DM_RECIPIENT_ID is required')
  }

  private async createDmChannel(recipientId: string): Promise<string> {
    // ref: https://discord.com/developers/docs/resources/user#create-dm
    const documentedResponse = await this.restClient.post<DiscordDmChannelResponse>('/users/@me/channels', {
      recipient_id: recipientId,
    })

    if (this.isSuccessfulStatus(documentedResponse.status)) {
      return documentedResponse.data.id
    }

    if (documentedResponse.status === BAD_REQUEST_STATUS) {
      const clientResponse = await this.restClient.post<DiscordDmChannelResponse>('/users/@me/channels', {
        recipients: [recipientId],
      })

      if (this.isSuccessfulStatus(clientResponse.status)) {
        return clientResponse.data.id
      }

      throw new HttpRequestError(
        this.withDiscordErrorDetail(
          'Discord create DM channel failed',
          clientResponse.data,
          documentedResponse.data,
        ),
        clientResponse.status,
        '/users/@me/channels',
      )
    }

    throw new HttpRequestError(
      this.withDiscordErrorDetail('Discord create DM channel failed', documentedResponse.data),
      documentedResponse.status,
      '/users/@me/channels',
    )
  }

  private async createMessage(channelId: string, content: string, retryCount = 0): Promise<void> {
    const endpoint = `/channels/${channelId}/messages`
    // ref: https://discord.com/developers/docs/resources/message#create-message
    const response = await this.restClient.post<DiscordCreateMessageResponse>(endpoint, {
      allowed_mentions: {
        parse: [],
      },
      content,
    })

    if (response.status === RATE_LIMIT_STATUS && retryCount < MAX_REST_RETRIES) {
      await sleep(this.getRateLimitDelayMs(response.data))
      await this.createMessage(channelId, content, retryCount + 1)
      return
    }

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError('Discord create message failed', response.status, endpoint)
    }

    if (response.data.id) {
      this.rememberSentMessageId(response.data.id)
    }
  }

  private async connectGateway(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.config.gatewayUrl, {
        headers: {
          Authorization: this.config.token,
          'User-Agent': DISCORD_USER_AGENT,
        },
      })
      this.gatewaySocket = socket
      let isSettled = false

      const timeout = setTimeout(() => {
        fail(new Error('Discord Gateway did not become ready in time'))
      }, READY_TIMEOUT_MS)

      const cleanupReadyWait = () => {
        clearTimeout(timeout)
        socket.off('error', fail)
        socket.off('close', onCloseBeforeReady)
      }

      const succeed = () => {
        if (isSettled) {
          return
        }

        isSettled = true
        cleanupReadyWait()
        resolve()
      }

      const fail = (error: Error) => {
        if (isSettled) {
          return
        }

        isSettled = true
        cleanupReadyWait()
        socket.close()
        reject(error)
      }

      const onCloseBeforeReady = (code: number, reason: Buffer) => {
        fail(new Error(`Discord Gateway closed before ready: ${code} ${reason.toString()}`))
      }

      socket.on('message', (data) => {
        try {
          this.onGatewayMessage(data.toString(), succeed)
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })

      socket.once('error', fail)
      socket.once('close', onCloseBeforeReady)
    })
  }

  private onGatewayMessage(rawMessage: string, onReady: () => void): void {
    const payload = JSON.parse(rawMessage) as GatewayPayload

    if (typeof payload.s === 'number') {
      this.sequence = payload.s
    }

    if (payload.op === GATEWAY_OPCODE_HELLO) {
      this.startHeartbeat((payload.d as GatewayHelloData).heartbeat_interval)
      this.identifyGatewaySession()
      return
    }

    if (payload.op === GATEWAY_OPCODE_DISPATCH && payload.t === GATEWAY_READY_EVENT) {
      const readyData = payload.d as GatewayReadyData

      if (!readyData.user?.id) {
        throw new Error('Discord Gateway READY payload did not include a user')
      }

      this.selfUserId = readyData.user.id
      onReady()
      return
    }

    if (payload.op === GATEWAY_OPCODE_DISPATCH && payload.t === GATEWAY_MESSAGE_CREATE_EVENT) {
      this.handleMessageCreate(payload.d as GatewayMessageCreateData)
    }
  }

  private startHeartbeat(heartbeatIntervalMs: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    this.sendGatewayPayload({
      op: GATEWAY_OPCODE_HEARTBEAT,
      d: this.sequence,
      s: null,
      t: null,
    })

    this.heartbeatTimer = setInterval(() => {
      this.sendGatewayPayload({
        op: GATEWAY_OPCODE_HEARTBEAT,
        d: this.sequence,
        s: null,
        t: null,
      })
    }, heartbeatIntervalMs)
  }

  private identifyGatewaySession(): void {
    // ref: https://discord.com/developers/docs/events/gateway-events#identify
    this.sendGatewayPayload<GatewayIdentifyData>({
      op: GATEWAY_OPCODE_IDENTIFY,
      d: {
        token: this.config.token,
        intents: this.config.gatewayIntents,
        properties: {
          os: process.platform,
          browser: 'owotify',
          device: 'owotify',
        },
      },
      s: null,
      t: null,
    })
  }

  private handleMessageCreate(message: GatewayMessageCreateData): void {
    if (this.sentMessageIds.delete(message.id)) {
      return
    }

    if (
      !this.config.commandsEnabled ||
      !this.commandHandler ||
      message.author.id !== this.selfUserId
    ) {
      return
    }

    const command = parseDiscordCommand(message.content, this.config.commandPrefix)

    if (!command) {
      return
    }

    void Promise.resolve(
      this.commandHandler({
        ...command,
        authorId: message.author.id,
        channelId: message.channel_id,
        messageId: message.id,
      }),
    ).catch((error) => {
      console.error(toSafeLogError(error))
    })
  }

  private sendGatewayPayload<TData>(payload: GatewayPayload<TData>): void {
    if (!this.gatewaySocket || this.gatewaySocket.readyState !== WebSocket.OPEN) {
      return
    }

    this.gatewaySocket.send(JSON.stringify(payload))
  }

  private getRateLimitDelayMs(data: unknown): number {
    const retryAfter = (data as DiscordRateLimitResponse | undefined)?.retry_after

    if (typeof retryAfter !== 'number') {
      return RATE_LIMIT_FALLBACK_MS
    }

    return Math.ceil(retryAfter * MILLISECONDS_PER_SECOND)
  }

  private rememberSentMessageId(messageId: string): void {
    this.sentMessageIds.add(messageId)

    if (this.sentMessageIds.size <= MAX_RECENT_SENT_MESSAGE_IDS) {
      return
    }

    const oldestMessageId = this.sentMessageIds.values().next().value as string | undefined

    if (oldestMessageId) {
      this.sentMessageIds.delete(oldestMessageId)
    }
  }

  private setTargetState(targetState: DiscordTargetState): void {
    this.targetState = targetState
    this.targetChannelId = targetState.channelId
  }

  private getRequiredTargetChannelId(): string {
    if (!this.targetChannelId) {
      throw new Error('Discord target channel has not been resolved')
    }

    return this.targetChannelId
  }

  private isSuccessfulStatus(status: number): boolean {
    return status >= SUCCESS_STATUS_MIN && status <= SUCCESS_STATUS_MAX
  }

  private withDiscordErrorDetail(message: string, data: unknown, fallbackData?: unknown): string {
    const detail = this.getDiscordErrorDetail(data) || this.getDiscordErrorDetail(fallbackData)

    if (!detail) {
      return message
    }

    return `${message}: ${detail}`
  }

  private getDiscordErrorDetail(data: unknown): string | null {
    if (!data || typeof data !== 'object') {
      return null
    }

    const error = data as DiscordErrorResponse
    const pieces = [
      typeof error.code === 'number' ? `code ${error.code}` : null,
      typeof error.message === 'string' ? error.message : null,
      error.errors ? JSON.stringify(error.errors) : null,
    ].filter((piece): piece is string => Boolean(piece))

    if (pieces.length === 0) {
      return null
    }

    return pieces.join(' - ').slice(0, MAX_ERROR_DETAIL_LENGTH)
  }

  private async waitForMessageWindow(): Promise<void> {
    const elapsedMs = Date.now() - this.lastMessageAtMs
    const waitMs = Math.max(MIN_WAIT_MS, this.config.minMessageIntervalMs - elapsedMs)

    if (waitMs > MIN_WAIT_MS) {
      await sleep(waitMs)
    }
  }
}
