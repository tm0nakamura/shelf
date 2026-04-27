import 'server-only'
import { adminClient } from '@/lib/supabase/admin'
import { decryptJson, encryptJson } from '@/lib/crypto'
import {
  isExpiringSoon,
  refreshAccessToken,
  type GoogleTokens,
} from './oauth'
import {
  searchMessages,
  getMessage,
  extractHtmlBody,
} from './gmail'
import { parseAmazonOrders, type AmazonProduct } from './amazon-parser'

type SyncResult = {
  added: number
  updated: number
  failed: number
  scanned: number
}

const AMAZON_QUERY = [
  'from:auto-confirm@amazon.co.jp',
  'OR from:digital-no-reply@amazon.co.jp',
  // Limit to a reasonable window — Phase 2 just hits the last 6 months.
  'newer_than:6m',
].join(' ')

/**
 * Sync one Gmail connection. Pulls Amazon order confirmations and
 * upserts each item into the items table.
 */
export async function syncGmailConnection(connectionId: string): Promise<SyncResult> {
  const supabase = adminClient()

  const { data: conn, error: connErr } = await supabase
    .from('connections')
    .select('id, user_id, credentials_encrypted, status')
    .eq('id', connectionId)
    .eq('provider', 'gmail')
    .maybeSingle()

  if (connErr || !conn) {
    throw new Error(`Gmail connection ${connectionId} not found: ${connErr?.message ?? 'no row'}`)
  }

  const creds = bytesFromPgrst((conn as { credentials_encrypted: string | Uint8Array }).credentials_encrypted)
  let tokens = decryptJson<GoogleTokens>(creds)

  if (isExpiringSoon(tokens)) {
    tokens = await refreshAccessToken(tokens.refresh_token)
    await supabase
      .from('connections')
      .update({ credentials_encrypted: encryptJson(tokens) })
      .eq('id', connectionId)
  }

  const startedAt = new Date().toISOString()
  const result: SyncResult = { added: 0, updated: 0, failed: 0, scanned: 0 }

  try {
    const messages = await searchMessages(tokens.access_token, AMAZON_QUERY, 200)
    result.scanned = messages.length

    const rows: Array<ReturnType<typeof productToItemRow>> = []

    for (const meta of messages) {
      try {
        const full = await getMessage(tokens.access_token, meta.id)
        const html = extractHtmlBody(full.payload)
        if (!html) continue
        const orders = parseAmazonOrders(html)
        for (const order of orders) {
          for (const product of order.products) {
            rows.push(productToItemRow({
              userId: conn.user_id,
              connectionId,
              messageId: meta.id,
              orderNumber: order.orderNumber,
              orderDate: order.orderDate,
              product,
            }))
          }
        }
      } catch {
        result.failed++
      }
    }

    if (rows.length > 0) {
      const { error: upsertErr, count } = await supabase
        .from('items')
        .upsert(rows, { onConflict: 'user_id,source,external_id', count: 'exact' })
      if (upsertErr) {
        result.failed += rows.length
        throw upsertErr
      }
      result.added = count ?? rows.length
    }

    await supabase
      .from('connections')
      .update({
        last_synced_at: new Date().toISOString(),
        next_sync_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        error_count: 0,
        status: 'active',
      })
      .eq('id', connectionId)

    await supabase.from('sync_logs').insert({
      connection_id: connectionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: result.failed > 0 ? 'partial' : 'success',
      items_added: result.added,
      items_updated: result.updated,
      items_failed: result.failed,
    })
  } catch (err) {
    await supabase
      .from('connections')
      .update({ error_count: 1, status: 'error' })
      .eq('id', connectionId)

    await supabase.from('sync_logs').insert({
      connection_id: connectionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'failed',
      items_added: 0,
      items_updated: 0,
      items_failed: result.failed,
      error_message: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  return result
}

function productToItemRow(args: {
  userId: string
  connectionId: string
  messageId: string
  orderNumber: string
  orderDate: string
  product: AmazonProduct
}) {
  const { product } = args
  // external_id needs to be unique per (user, source). Pair the order number
  // with the ASIN (or title hash if ASIN is missing) so the same product in
  // two different orders both land.
  const fallback = product.asin ?? `t-${hashString(product.title)}`
  const externalId = `${args.orderNumber}:${fallback}`
  return {
    user_id: args.userId,
    connection_id: args.connectionId,
    source: 'gmail_amazon' as const,
    category: product.category,
    external_id: externalId,
    title: product.title,
    creator: null,
    cover_image_url: product.imageUrl,
    source_url: product.productUrl,
    metadata: {
      asin: product.asin,
      order_number: args.orderNumber,
      gmail_message_id: args.messageId,
      classifier_confidence: product.category_confidence,
    },
    price_jpy: product.price,
    acquired_at: args.orderDate,
  }
}

function hashString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

function bytesFromPgrst(value: string | Uint8Array): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) return Buffer.from(value.slice(2), 'hex')
    return Buffer.from(value, 'base64')
  }
  throw new Error('Unrecognized bytea encoding from pgrst')
}
