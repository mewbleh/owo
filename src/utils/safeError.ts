interface ErrorLike {
  name?: unknown
  message?: unknown
  stack?: unknown
  code?: unknown
  statusCode?: unknown
  targetUrl?: unknown
  config?: {
    method?: unknown
    url?: unknown
    baseURL?: unknown
  }
  response?: {
    status?: unknown
  }
}

export interface SafeLogError {
  name: string
  message: string
  stack?: string
  code?: string
  statusCode?: number
  targetUrl?: string
  request?: {
    method?: string
    url?: string
    baseUrl?: string
  }
}

export const toSafeLogError = (error: unknown): SafeLogError => {
  if (!isErrorLike(error)) {
    return {
      name: 'UnknownError',
      message: String(error),
    }
  }

  const statusCode = toOptionalNumber(error.statusCode) ?? toOptionalNumber(error.response?.status)

  return {
    name: toOptionalString(error.name) ?? 'Error',
    message: toOptionalString(error.message) ?? 'Unknown error',
    stack: toOptionalString(error.stack),
    code: toOptionalString(error.code),
    statusCode,
    targetUrl: toOptionalString(error.targetUrl),
    request: {
      method: toOptionalString(error.config?.method),
      url: toOptionalString(error.config?.url),
      baseUrl: toOptionalString(error.config?.baseURL),
    },
  }
}

const isErrorLike = (error: unknown): error is ErrorLike => {
  return typeof error === 'object' && error !== null
}

const toOptionalString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const toOptionalNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' ? value : undefined
}
