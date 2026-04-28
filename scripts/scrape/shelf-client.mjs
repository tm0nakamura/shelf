/**
 * Tiny POST-to-shelf helper. Bulk-uploads scraped items to the
 * /api/import endpoint with the configured bearer token.
 */
export async function pushItems({ source, items }) {
  const baseUrl = process.env.SHELF_API_URL
  const token = process.env.SHELF_IMPORT_TOKEN
  if (!baseUrl || !token) {
    throw new Error('SHELF_API_URL and SHELF_IMPORT_TOKEN must be set in env')
  }
  if (items.length === 0) {
    console.log('[shelf] nothing to import')
    return { count: 0 }
  }
  const res = await fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ source, items }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`/api/import -> ${res.status}: ${text}`)
  }
  console.log(`[shelf] uploaded ${items.length} items (${source}): ${text}`)
  return JSON.parse(text)
}
