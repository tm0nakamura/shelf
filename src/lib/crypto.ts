import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from './env'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function key(): Buffer {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"')
  }
  return Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex')
}

/**
 * Encrypt a JSON-serializable object. Returns a Postgres bytea-literal
 * string of the form `\xABCD…` so it survives Supabase / PostgREST's
 * JSON serialization intact (Buffer would get JSON-stringified into
 * `{"type":"Buffer","data":[…]}` and never land in the bytea column).
 *
 * Layout once decoded: [iv (12B) | tag (16B) | ciphertext].
 */
export function encryptJson(value: unknown): string {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return '\\x' + Buffer.concat([iv, tag, ct]).toString('hex')
}

/**
 * Decrypt whatever Postgres / PostgREST hands back: a `\x…` hex literal,
 * a base64 string (other PostgREST encodings), or raw bytes from a
 * direct SQL select.
 */
export function decryptJson<T = unknown>(blob: string | Buffer | Uint8Array): T {
  let buf: Buffer
  if (typeof blob === 'string') {
    if (blob.startsWith('\\x')) {
      buf = Buffer.from(blob.slice(2), 'hex')
    } else {
      buf = Buffer.from(blob, 'base64')
    }
  } else if (Buffer.isBuffer(blob)) {
    buf = blob
  } else {
    buf = Buffer.from(blob)
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(pt.toString('utf8')) as T
}
