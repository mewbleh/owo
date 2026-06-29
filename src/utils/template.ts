const TEMPLATE_TOKEN_PATTERN = /\{([a-zA-Z0-9_]+)\}/g

export type TemplateValues = Record<string, string | number | boolean | null | undefined>

export const formatTemplate = (template: string, values: TemplateValues): string => {
  return template.replace(TEMPLATE_TOKEN_PATTERN, (token, key: string) => {
    const value = values[key]

    if (value === null || value === undefined) {
      return token
    }

    return String(value)
  })
}
