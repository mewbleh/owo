import 'dotenv/config'

import axios from 'axios'
import { randomBytes } from 'crypto'
import { createServer } from 'http'
import type { ServerResponse } from 'http'

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SCOPE = 'user-read-currently-playing'
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:4377/callback'
const STATE_BYTE_LENGTH = 16
const CALLBACK_TIMEOUT_MS = 120_000
const SUCCESS_STATUS_MIN = 200
const SUCCESS_STATUS_MAX = 299

interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

const main = async (): Promise<void> => {
  const clientId = getRequiredEnv('SPOTIFY_CLIENT_ID')
  const clientSecret = getRequiredEnv('SPOTIFY_CLIENT_SECRET')
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || DEFAULT_REDIRECT_URI
  const state = randomBytes(STATE_BYTE_LENGTH).toString('hex')
  const authorizationUrl = buildAuthorizationUrl(clientId, redirectUri, state)

  console.log('Open this URL, approve access, then return here:')
  console.log(authorizationUrl.toString())

  const code = await waitForAuthorizationCode(redirectUri, state)
  const tokenResponse = await exchangeCodeForToken(clientId, clientSecret, redirectUri, code)

  if (!tokenResponse.refresh_token) {
    throw new Error('Spotify did not return a refresh token')
  }

  console.log('\nAdd this to your .env:')
  console.log(`SPOTIFY_REFRESH_TOKEN=${tokenResponse.refresh_token}`)
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

const buildAuthorizationUrl = (clientId: string, redirectUri: string, state: string): URL => {
  const url = new URL(SPOTIFY_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', SPOTIFY_SCOPE)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)

  return url
}

const waitForAuthorizationCode = async (redirectUri: string, expectedState: string): Promise<string> => {
  const callbackUrl = new URL(redirectUri)
  const port = Number(callbackUrl.port)
  const hostname = callbackUrl.hostname

  if (!Number.isInteger(port)) {
    throw new Error('SPOTIFY_REDIRECT_URI must include a port, such as :4377')
  }

  return new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', redirectUri)

        if (requestUrl.pathname !== callbackUrl.pathname) {
          response.writeHead(404, { 'Content-Type': 'text/plain' })
          response.end('Not found')
          return
        }

        const error = requestUrl.searchParams.get('error')

        if (error) {
          respond(response, 'Spotify authorization failed. You can close this tab.')
          cleanup()
          reject(new Error(`Spotify authorization failed: ${error}`))
          return
        }

        const state = requestUrl.searchParams.get('state')
        const code = requestUrl.searchParams.get('code')

        if (state !== expectedState) {
          respond(response, 'State mismatch. You can close this tab.')
          cleanup()
          reject(new Error('Spotify authorization state mismatch'))
          return
        }

        if (!code) {
          respond(response, 'Missing authorization code. You can close this tab.')
          cleanup()
          reject(new Error('Spotify did not return an authorization code'))
          return
        }

        respond(response, 'Spotify authorization complete. You can close this tab.')
        cleanup()
        resolve(code)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for Spotify authorization callback'))
    }, CALLBACK_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      server.close()
    }

    server.once('error', (error) => {
      cleanup()
      reject(error)
    })

    server.listen(port, hostname)
  })
}

const exchangeCodeForToken = async (
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<SpotifyTokenResponse> => {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })

  const response = await axios.post<SpotifyTokenResponse>(SPOTIFY_TOKEN_URL, body, {
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    validateStatus: () => true,
  })

  if (response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
    throw new Error(`Spotify token exchange failed with status ${response.status}`)
  }

  return response.data
}

const respond = (response: ServerResponse, content: string) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end(content)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
