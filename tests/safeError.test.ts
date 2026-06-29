import { describe, expect, it } from 'vitest'

import { toSafeLogError } from '../src/utils/safeError'

describe('toSafeLogError', () => {
  it('omits request headers from axios-like errors', () => {
    const error = {
      name: 'AxiosError',
      message: 'request failed',
      code: 'ECONNABORTED',
      config: {
        baseURL: 'https://discord.com/api/v10',
        headers: {
          Authorization: 'secret-token',
        },
        method: 'post',
        url: '/channels/123/messages',
      },
      response: {
        status: 500,
      },
    }

    const safeError = toSafeLogError(error)

    expect(JSON.stringify(safeError)).not.toContain('secret-token')
    expect(safeError).toMatchObject({
      code: 'ECONNABORTED',
      request: {
        method: 'post',
        url: '/channels/123/messages',
      },
      statusCode: 500,
    })
  })
})
