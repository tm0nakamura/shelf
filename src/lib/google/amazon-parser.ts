/**
 * Parse Amazon.co.jp order confirmation emails. We rely on the Schema.org
 * Order / OrderAction JSON-LD blocks Amazon embeds in <script type="application/ld+json">.
 *
 * Reference layout (real Amazon JP confirmation):
 *   { "@context": "http://schema.org",
 *     "@type": "Order",
 *     "merchant": { "@type": "Organization", "name": "Amazon.co.jp" },
 *     "orderNumber": "503-XXXXXXX-XXXXXXX",
 *     "orderStatus": "http://schema.org/OrderProcessing",
 *     "priceCurrency": "JPY",
 *     "price": "1500",
 *     "orderDate": "2024-08-15T12:00:00+09:00",
 *     "acceptedOffer": [
 *       { "@type": "Offer",
 *         "itemOffered": { "@type": "Product", "name": "...", "image": "...", "url": "..." },
 *         "price": "1500", "priceCurrency": "JPY", "eligibleQuantity": { "value": 1 } }
 *     ]
 *   }
 *
 * Amazon also wraps confirmations as OrderAction; we handle both.
 */

import type { Category } from '@/components/shelf/Shelf'

export type AmazonProduct = {
  asin: string | null
  title: string
  imageUrl: string | null
  productUrl: string | null
  price: number | null
  category: Category
  category_confidence: 'high' | 'medium' | 'low'
}

export type AmazonOrder = {
  orderNumber: string
  orderDate: string  // ISO
  total: number | null
  products: AmazonProduct[]
}

type SchemaOrgValue = string | number | boolean | null | SchemaOrgValue[] | { [k: string]: SchemaOrgValue }

/**
 * Find every <script type="application/ld+json"> block in the email body
 * and return the parsed JSON values. Tolerates malformed blocks.
 */
export function extractJsonLd(html: string): SchemaOrgValue[] {
  const out: SchemaOrgValue[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    try {
      out.push(JSON.parse(raw))
    } catch {
      // Some blocks contain HTML entities — try a light unescape pass.
      try {
        out.push(JSON.parse(unescapeHtml(raw)))
      } catch {
        // Skip unparseable block.
      }
    }
  }
  return out
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Walk a JSON-LD value tree and yield every node whose @type matches
 * one of the given types (case-insensitive, supports array @type).
 */
function* findByType(node: SchemaOrgValue, ...types: string[]): Generator<Record<string, SchemaOrgValue>> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) yield* findByType(child, ...types)
    return
  }
  const obj = node as Record<string, SchemaOrgValue>
  const t = obj['@type']
  const tArr = Array.isArray(t) ? t : [t]
  if (tArr.some((v) => typeof v === 'string' && types.some((want) => v.toLowerCase() === want.toLowerCase()))) {
    yield obj
  }
  for (const v of Object.values(obj)) yield* findByType(v, ...types)
}

export function parseAmazonOrders(html: string): AmazonOrder[] {
  const ldBlocks = extractJsonLd(html)
  const orders: AmazonOrder[] = []

  for (const block of ldBlocks) {
    // Order can be the top node, nested inside OrderAction, or in @graph
    for (const order of findByType(block, 'Order')) {
      const orderNumber = stringField(order, 'orderNumber') ?? ''
      if (!orderNumber) continue

      const orderDate = stringField(order, 'orderDate') ?? new Date().toISOString()
      const total = numberField(order, 'price')
      const products: AmazonProduct[] = []

      const offers = order['acceptedOffer']
      const offerArr = Array.isArray(offers) ? offers : (offers ? [offers] : [])
      for (const offer of offerArr) {
        if (!offer || typeof offer !== 'object' || Array.isArray(offer)) continue
        const offerObj = offer as Record<string, SchemaOrgValue>
        const itemOffered = offerObj['itemOffered']
        if (!itemOffered || typeof itemOffered !== 'object' || Array.isArray(itemOffered)) continue
        const product = itemOffered as Record<string, SchemaOrgValue>

        const title = stringField(product, 'name') ?? ''
        if (!title) continue

        const productUrl = stringField(product, 'url')
        const imageUrl = stringField(product, 'image')
        const price = numberField(offerObj, 'price') ?? numberField(product, 'price')
        const asin = extractAsin(productUrl)
        const { category, confidence } = classify(title, productUrl, imageUrl)

        products.push({
          asin,
          title,
          imageUrl: imageUrl ?? null,
          productUrl: productUrl ?? null,
          price,
          category,
          category_confidence: confidence,
        })
      }

      if (products.length > 0) {
        orders.push({ orderNumber, orderDate, total, products })
      }
    }
  }

  return orders
}

function stringField(obj: Record<string, SchemaOrgValue>, key: string): string | undefined {
  const v = obj[key]
  if (typeof v === 'string') return v
  return undefined
}
function numberField(obj: Record<string, SchemaOrgValue>, key: string): number | null {
  const v = obj[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extractAsin(url: string | undefined | null): string | null {
  if (!url) return null
  const m = url.match(/\/dp\/([A-Z0-9]{10})/)
  return m ? m[1] : null
}

/**
 * Crude keyword classifier on title + URL. Good enough for Phase 2 MVP.
 * Confidence is "high" when we have a strong genre keyword, "medium" for
 * weaker hints, "low" when we fall back to default 'book'.
 */
function classify(
  title: string,
  url: string | null | undefined,
  image: string | null | undefined,
): { category: Category; confidence: 'high' | 'medium' | 'low' } {
  const t = title.toLowerCase()
  const u = (url ?? '').toLowerCase()
  const img = (image ?? '').toLowerCase()
  const all = `${t} ${u} ${img}`

  // Games — fairly distinct keywords
  if (/\b(switch|ps5|ps4|xbox|nintendo|playstation|game(s)?)\b/i.test(all)
      || /(ゲーム|ファミコン|プレイステーション|ニンテンドー)/.test(title)) {
    return { category: 'game', confidence: 'high' }
  }

  // Films — physical media
  if (/\b(blu-?ray|dvd|4k uhd)\b/i.test(all)
      || /(ブルーレイ|劇場版)/.test(title)) {
    return { category: 'film', confidence: 'high' }
  }

  // Music — CDs / albums
  if (/\b(cd|album|single|ep)\b/i.test(t)
      || /(アルバム|シングル|サウンドトラック|ost)/i.test(title)) {
    return { category: 'music', confidence: 'medium' }
  }

  // Comics — volume markers
  if (/(コミック|漫画|まんが|マンガ)/.test(title)
      || /\b(vol\.?\s*\d+|第\s*\d+\s*巻|\(\d+\))/i.test(title)
      || /(\d+)\s*巻/.test(title)) {
    return { category: 'comic', confidence: 'medium' }
  }

  // Default: book (Amazon JP's largest category)
  return { category: 'book', confidence: 'low' }
}
