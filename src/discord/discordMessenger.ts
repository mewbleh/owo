import axios from 'axios'
import type { AxiosInstance } from 'axios'
import WebSocket from 'ws'

import { HttpRequestError } from '../errors'
import { splitMessage } from '../utils/message'
import { sleep } from '../utils/sleep'

const DISCORD_USER_AGENT = 'owotify/1.0.0'
const READY_TIMEOUT_MS = 30_000
const MIN_WAIT_MS = 0
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 299
const RATE_LIMIT_STATUS = 429
const MAX_REST_RETRIES = 3
const RATE_LIMIT_FALLBACK_MS = 1000
const MILLISECONDS_PER_SECOND = 1000
const WEBSOCKET_NORMAL_CLOSE_CODE = 1000
// ref: https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-opcodes
const GATEWAY_OPCODE_DISPATCH = 0
const GATEWAY_OPCODE_HEARTBEAT = 1
const GATEWAY_OPCODE_IDENTIFY = 2
const GATEWAY_OPCODE_HELLO = 10
const GATEWAY_READY_EVENT = 'READY'
const DISCORD_EMPTY_INTENTS = 0

interface DiscordMessengerConfig {
  token: string
  channelId: string
  apiBaseUrl: string
  gatewayUrl: string
  gatewayEnabled: boolean
  minMessageIntervalMs: number
  maxMessageLength: number
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
  user: {
    id: string
    username: string
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

export class DiscordMessenger {
  private readonly restClient: AxiosInstance
  private gatewaySocket: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private sequence: number | null = null
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

  async login(): Promise<void> {
    await this.validateToken()

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
      await this.createMessage(chunk)
      this.lastMessageAtMs = Date.now()
    }
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
    const response = await this.restClient.get('/users/@me')

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError('Discord token validation failed', response.status, '/users/@me')
    }
  }

  private async createMessage(content: string, retryCount = 0): Promise<void> {
    const endpoint = `/channels/${this.config.channelId}/messages`
    // ref: https://discord.com/developers/docs/resources/message#create-message
    const response = await this.restClient.post(endpoint, {
      allowed_mentions: {
        parse: [],
      },
      content,
    })

    if (response.status === RATE_LIMIT_STATUS && retryCount < MAX_REST_RETRIES) {
      await sleep(this.getRateLimitDelayMs(response.data))
      await this.createMessage(content, retryCount + 1)
      return
    }

    if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
      throw new HttpRequestError('Discord create message failed', response.status, endpoint)
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

      onReady()
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
        intents: DISCORD_EMPTY_INTENTS,
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

  private async waitForMessageWindow(): Promise<void> {
    const elapsedMs = Date.now() - this.lastMessageAtMs
    const waitMs = Math.max(MIN_WAIT_MS, this.config.minMessageIntervalMs - elapsedMs)

    if (waitMs > MIN_WAIT_MS) {
      await sleep(waitMs)
    }
  }
}
