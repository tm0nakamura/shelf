import 'server-only'
import chromium from '@sparticuz/chromium'
import { chromium as playwright, type Page } from 'playwright-core'
import type { SerializedCookie } from './types'

/**
 * Headless login flow for shonenjumpplus.com.
 *
 * Returns the authenticated session cookies on success. Throws on:
 *   - 2FA / CAPTCHA challenge (we don't have a path through these)
 *   - bot-mitigation page (Vercel IP blocked)
 *   - bad credentials (login form re-renders with error)
 *
 * Selectors are best-effort and may need adjustment when Jump+'s login
 * markup changes. The function never persists the password — callers
 * decide what to do with both the input and the returned cookies.
 */
export async function loginToJumpplus(args: {
  email: string
  password: string
}): Promise<SerializedCookie[]> {
  const browser = await playwright.launch({
    args: [...chromium.args, '--lang=ja-JP'],
    executablePath: await chromium.executablePath(),
    headless: true,
  })

  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'ja-JP',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })
    const page = await ctx.newPage()

    await page.goto('https://shonenjumpplus.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    })

    // Bail if Cloudflare / bot-mitigation page is served.
    await assertNoBotChallenge(page)

    // Fill the form. Jump+ uses standard email + password fields. Adjust
    // selectors if their markup drifts.
    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[id*="email" i]',
    ).first()
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]',
    ).first()
    await emailInput.fill(args.email, { timeout: 10000 })
    await passwordInput.fill(args.password, { timeout: 10000 })

    const submit = page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("ログイン")',
    ).first()
    await Promise.all([
      page.waitForURL(
        (url) => !url.toString().includes('/login'),
        { timeout: 15000 },
      ).catch(() => {}),
      submit.click(),
    ])

    // If we're still on the login page, login failed.
    if (page.url().includes('/login')) {
      const errText = await page
        .locator('[class*="error" i], [role="alert"]')
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => null)
      throw new Error(`jumpplus_login_failed: ${errText?.trim() || 'still on /login'}`)
    }

    // Touch /mypage to confirm the session is real.
    await page.goto('https://shonenjumpplus.com/mypage', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    if (page.url().includes('/login')) {
      throw new Error('jumpplus_login_failed: redirected back to /login after submit')
    }

    const raw = await ctx.cookies()
    return raw.map(toSerializable)
  } finally {
    await browser.close().catch(() => {})
  }
}

async function assertNoBotChallenge(page: Page): Promise<void> {
  const title = (await page.title().catch(() => '')) || ''
  const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
  if (
    /just a moment|cloudflare|access denied|attention required/i.test(title) ||
    /just a moment|cloudflare|access denied|attention required/i.test(bodyText.slice(0, 500))
  ) {
    throw new Error('jumpplus_bot_challenge: Cloudflare or similar bot-mitigation triggered')
  }
}

function toSerializable(c: {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}): SerializedCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires > 0 ? c.expires : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }
}
