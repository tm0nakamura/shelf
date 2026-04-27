/**
 * Thin wrapper around Gmail REST API v1. Just the bits we need:
 *  - search messages by query string
 *  - fetch full message (with body) by id
 *  - extract HTML part and decode base64url
 */

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

type MessageMeta = { id: string; threadId: string }

type MessagePayloadHeader = { name: string; value: string }
type MessagePayloadBody = { size: number; data?: string; attachmentId?: string }
type MessagePayload = {
  partId?: string
  mimeType: string
  filename?: string
  headers?: MessagePayloadHeader[]
  body?: MessagePayloadBody
  parts?: MessagePayload[]
}

export type FullMessage = {
  id: string
  threadId: string
  internalDate: string  // ms epoch as string
  payload: MessagePayload
  snippet: string
}

async function gfetch<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Gmail API ${url} -> ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export async function searchMessages(
  accessToken: string,
  q: string,
  maxResults = 100,
): Promise<MessageMeta[]> {
  const out: MessageMeta[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q, maxResults: String(Math.min(maxResults - out.length, 100)) })
    if (pageToken) params.set('pageToken', pageToken)
    const data: { messages?: MessageMeta[]; nextPageToken?: string } =
      await gfetch(`${BASE}/messages?${params.toString()}`, accessToken)
    if (data.messages) out.push(...data.messages)
    pageToken = data.nextPageToken
  } while (pageToken && out.length < maxResults)
  return out.slice(0, maxResults)
}

export async function getMessage(accessToken: string, id: string): Promise<FullMessage> {
  return gfetch<FullMessage>(`${BASE}/messages/${id}?format=full`, accessToken)
}

/** Decode base64url (Gmail's standard body encoding) into a UTF-8 string. */
export function decodeBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

/**
 * Walk the MIME tree and return the first HTML part body. Falls back to
 * plain text body if no HTML part exists.
 */
export function extractHtmlBody(payload: MessagePayload): string | null {
  function walk(p: MessagePayload): string | null {
    if (p.mimeType === 'text/html' && p.body?.data) {
      return decodeBase64Url(p.body.data)
    }
    if (p.parts) {
      for (const child of p.parts) {
        const found = walk(child)
        if (found) return found
      }
    }
    return null
  }
  function walkText(p: MessagePayload): string | null {
    if (p.mimeType === 'text/plain' && p.body?.data) {
      return decodeBase64Url(p.body.data)
    }
    if (p.parts) {
      for (const child of p.parts) {
        const found = walkText(child)
        if (found) return found
      }
    }
    return null
  }
  return walk(payload) ?? walkText(payload)
}

export function getHeader(payload: MessagePayload, name: string): string | undefined {
  return payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value
}
