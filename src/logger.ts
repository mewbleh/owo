import pino from 'pino'

import type { AppConfig } from './config'

export const createLogger = (config: AppConfig) => {
  return pino({
    level: config.owotify.logLevel,
  })
}
