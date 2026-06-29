export interface DiscordCommand {
  name: string
  args: string[]
  content: string
}

export const parseDiscordCommand = (content: string, prefix: string): DiscordCommand | null => {
  const trimmedContent = content.trim()

  if (!trimmedContent.startsWith(prefix)) {
    return null
  }

  const bodyWithBoundary = trimmedContent.slice(prefix.length)

  if (bodyWithBoundary.length > 0 && !/^\s/.test(bodyWithBoundary)) {
    return null
  }

  const body = bodyWithBoundary.trim()

  if (body.length === 0) {
    return {
      name: 'help',
      args: [],
      content: trimmedContent,
    }
  }

  const [name = '', ...args] = body.split(/\s+/)

  return {
    name: name.toLowerCase(),
    args,
    content: trimmedContent,
  }
}
