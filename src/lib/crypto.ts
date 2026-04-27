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
 * Encrypt a JSON-serializable object. Returns a Buffer suitable for storing
 * in a Postgres bytea column. Layout: [iv | tag | ciphertext].
 */
export function encryptJson(value: unknown): Buffer {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct])
}

export function decryptJson<T = unknown>(blob: Buffer | Uint8Array): T {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(pt.toString('utf8')) as T
}
