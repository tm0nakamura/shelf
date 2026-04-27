import { z } from 'zod'

/** Treat "" and undefined as the same — env vars often arrive as empty strings. */
const optionalStr = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().min(1).optional())

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: optionalStr,
  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,
  SPOTIFY_CLIENT_ID: optionalStr,
  SPOTIFY_CLIENT_SECRET: optionalStr,
  APP_URL: z.string().url().default('http://127.0.0.1:3000'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().regex(/^[0-9a-f]{64}$/).optional()),
})

export const env = schema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? '',
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  APP_URL: process.env.APP_URL ?? 'http://127.0.0.1:3000',
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? '',
})

export const SPOTIFY_REDIRECT_URI = `${env.APP_URL}/api/spotify/callback`
