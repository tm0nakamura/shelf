import { z } from 'zod'

/** Treat "" and undefined as the same — env vars often arrive as empty strings. */
const optionalStr = z
  .string()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.string().min(1).optional())

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: optionalStr,
  SPOTIFY_CLIENT_ID: optionalStr,
  SPOTIFY_CLIENT_SECRET: optionalStr,
  APP_URL: z.string().url().default('http://localhost:3000'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(z.string().regex(/^[0-9a-f]{64}$/).optional()),
})

export const env = schema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? '',
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  APP_URL: process.env.APP_URL ?? 'http://localhost:3000',
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? '',
})

export const SPOTIFY_REDIRECT_URI = `${env.APP_URL}/api/spotify/callback`
