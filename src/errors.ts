export class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly targetUrl: string,
    options?: ErrorOptions,
  ) {
    super(`${message} (status ${statusCode}, url ${targetUrl})`, options)
    this.name = 'HttpRequestError'
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
