import { createWriteStream, openAsBlob } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { FastifyBaseLogger } from 'fastify'
import {
  markConversationAttachmentFailed,
  markConversationAttachmentLinked,
  markConversationAttachmentUploaded,
  PendingConversationAttachment
} from '../conversations/conversation.repository'
import { createGlpiDocument, linkGlpiDocumentToTicket } from './glpi.client'

type SyncConversationAttachmentsInput = {
  logger: FastifyBaseLogger
  sessionToken: string
  glpiTicketId: number
  glpiEntityId: number | null
  attachments: PendingConversationAttachment[]
}

type DownloadedAttachmentFile = {
  tempDirPath: string
  tempFilePath: string
  fileName: string
  mimeType: string | null
}

export class GlpiAttachmentSyncError extends Error {
  stage: 'document_upload' | 'document_link'

  constructor(
    stage: 'document_upload' | 'document_link',
    message: string,
    cause?: unknown
  ) {
    super(message)
    this.name = 'GlpiAttachmentSyncError'
    this.stage = stage

    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function inferExtensionFromMimeType(mimeType: string | null) {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'application/pdf':
      return '.pdf'
    case 'audio/ogg':
      return '.ogg'
    case 'audio/mpeg':
      return '.mp3'
    case 'video/mp4':
      return '.mp4'
    default:
      return ''
  }
}

function buildAttachmentFileName(
  attachment: PendingConversationAttachment,
  mimeType: string | null
) {
  try {
    const parsedUrl = new URL(attachment.mediaUrl)
    const baseName = sanitizeFileName(basename(parsedUrl.pathname))

    if (baseName && extname(baseName)) {
      return baseName
    }

    if (baseName) {
      return `${baseName}${inferExtensionFromMimeType(mimeType)}`
    }
  } catch {
    // ignore invalid URL parsing and fallback to generated filename
  }

  return `attachment-${attachment.id}${inferExtensionFromMimeType(mimeType)}`
}

function buildDocumentName(fileName: string) {
  const extension = extname(fileName)
  return extension ? fileName.slice(0, -extension.length) : fileName
}

async function downloadAttachmentToTempFile(
  attachment: PendingConversationAttachment
): Promise<DownloadedAttachmentFile> {
  const response = await fetch(attachment.mediaUrl)

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download attachment from mediaUrl: status=${response.status}`
    )
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] ?? null
  const fileName = buildAttachmentFileName(attachment, mimeType)
  const tempDirPath = await mkdtemp(join(tmpdir(), 'mtalk-bot-attachment-'))
  const tempFilePath = join(tempDirPath, fileName)

  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream),
    createWriteStream(tempFilePath)
  )

  return {
    tempDirPath,
    tempFilePath,
    fileName,
    mimeType
  }
}

async function cleanupDownloadedAttachmentFile(file: DownloadedAttachmentFile) {
  await rm(file.tempDirPath, { recursive: true, force: true })
}

async function uploadAttachmentDocumentToGlpi(
  sessionToken: string,
  attachment: PendingConversationAttachment,
  glpiEntityId: number | null
) {
  const downloadedFile = await downloadAttachmentToTempFile(attachment)

  try {
    const formData = new FormData()
    const fileBlob = await openAsBlob(downloadedFile.tempFilePath, {
      type: downloadedFile.mimeType ?? undefined
    })

    formData.append(
      'uploadManifest',
      JSON.stringify({
        input: {
          name: buildDocumentName(downloadedFile.fileName),
          ...(glpiEntityId ? { entities_id: glpiEntityId } : {}),
          _filename: [downloadedFile.fileName]
        }
      })
    )
    formData.append('filename[0]', fileBlob, downloadedFile.fileName)

    let response

    try {
      response = await createGlpiDocument(sessionToken, formData)
    } catch (error) {
      throw new GlpiAttachmentSyncError(
        'document_upload',
        'Failed to upload attachment document to GLPI',
        error
      )
    }

    const glpiDocumentId = response.id

    if (!glpiDocumentId) {
      throw new Error('GLPI document upload returned no id')
    }

    await markConversationAttachmentUploaded(attachment.id, {
      glpiDocumentId,
      mimeType: downloadedFile.mimeType,
      fileName: downloadedFile.fileName
    })

    return {
      glpiDocumentId,
      mimeType: downloadedFile.mimeType,
      fileName: downloadedFile.fileName
    }
  } finally {
    await cleanupDownloadedAttachmentFile(downloadedFile)
  }
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown attachment sync error'
}

async function syncOneConversationAttachmentToGlpi(
  logger: FastifyBaseLogger,
  sessionToken: string,
  glpiTicketId: number,
  glpiEntityId: number | null,
  attachment: PendingConversationAttachment
) {
  try {
    const uploadResult = attachment.glpiDocumentId
      ? {
          glpiDocumentId: attachment.glpiDocumentId,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName
        }
      : await uploadAttachmentDocumentToGlpi(
          sessionToken,
          attachment,
          glpiEntityId
        )

    try {
      await linkGlpiDocumentToTicket(sessionToken, {
        input: {
          documents_id: uploadResult.glpiDocumentId,
          itemtype: 'Ticket',
          items_id: glpiTicketId
        }
      })
    } catch (error) {
      throw new GlpiAttachmentSyncError(
        'document_link',
        'Failed to link GLPI document to ticket',
        error
      )
    }

    await markConversationAttachmentLinked(
      attachment.id,
      uploadResult.glpiDocumentId
    )

    logger.info({
      msg: 'GLPI attachment synchronized successfully',
      mtalkTicketId: attachment.mtalkTicketId,
      attachmentId: attachment.id,
      glpiTicketId,
      glpiDocumentId: uploadResult.glpiDocumentId,
      fileName: uploadResult.fileName
    })
  } catch (error) {
    await markConversationAttachmentFailed(attachment.id, summarizeError(error))
    throw error
  }
}

export async function syncConversationAttachmentsToGlpi(
  input: SyncConversationAttachmentsInput
) {
  for (const attachment of input.attachments) {
    await syncOneConversationAttachmentToGlpi(
      input.logger,
      input.sessionToken,
      input.glpiTicketId,
      input.glpiEntityId,
      attachment
    )
  }
}
