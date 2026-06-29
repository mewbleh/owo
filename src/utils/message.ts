const MIN_MESSAGE_LENGTH = 1

export const splitMessage = (content: string, maxLength: number): string[] => {
  const trimmedContent = content.trim()

  if (trimmedContent.length < MIN_MESSAGE_LENGTH) {
    return []
  }

  if (trimmedContent.length <= maxLength) {
    return [trimmedContent]
  }

  const chunks: string[] = []
  let currentChunk = ''

  for (const line of trimmedContent.split('\n')) {
    const candidate = currentChunk.length > 0 ? `${currentChunk}\n${line}` : line

    if (candidate.length <= maxLength) {
      currentChunk = candidate
      continue
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
      currentChunk = ''
    }

    if (line.length <= maxLength) {
      currentChunk = line
      continue
    }

    for (let index = 0; index < line.length; index += maxLength) {
      chunks.push(line.slice(index, index + maxLength))
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}
