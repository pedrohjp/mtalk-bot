const OMNI_MESSAGE_PREFIX = '*OMNI*:'

export function formatOmniMessage(content: string) {
  const normalizedContent = content.trim()

  if (/^\*OMNI\*:/i.test(normalizedContent)) {
    return normalizedContent
  }

  return `${OMNI_MESSAGE_PREFIX} ${normalizedContent}`
}
