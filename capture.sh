#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CAPTURE_URL:-}" || -z "${CAPTURE_DIR:-}" ]]; then
  echo 'Set CAPTURE_URL and CAPTURE_DIR.' >&2
  exit 1
fi

/usr/bin/time -p node --input-type=module - "$CAPTURE_URL" "$CAPTURE_DIR" <<'NODE'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const [url, output] = process.argv.slice(2)
let parsed
try { parsed = new URL(url) } catch { console.error('CAPTURE_URL must be an absolute URL.'); process.exit(1) }
if (!['http:', 'https:'].includes(parsed.protocol)) { console.error('CAPTURE_URL must use HTTP or HTTPS.'); process.exit(1) }

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright')
const require = createRequire(join(runtime, 'package.json'))
const { chromium } = require('playwright')
const config = JSON.parse(await readFile(join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json'), 'utf8'))
if (process.platform === 'linux') process.env.DISPLAY ||= ':' + (await readFile(join(runtime, 'display'), 'utf8')).trim()
await mkdir(output, { recursive: true })
const transient = error => Object.assign(error instanceof Error ? error : new Error(String(error)), { exitCode: 75 })
let browser
let exitCode = 0
try {
  browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(error => { throw transient(error) })
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    let page
    try { page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: name === 'mobile', hasTouch: name === 'mobile' }) }
    catch (error) { throw transient(error) }
    const renderErrors = []
    page.on('pageerror', error => renderErrors.push(error.message))
    page.setDefaultTimeout(20000)
    let response
    try { response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }) }
    catch (error) { throw transient(error) }
    if (!response?.ok()) {
      const status = response?.status()
      throw Object.assign(new Error(`Preview returned HTTP ${status ?? 'no response'}: ${url}`), { exitCode: !status || [408, 429, 500, 502, 503, 504].includes(status) ? 75 : 1 })
    }
    try {
      await page.locator('.menu').waitFor({ state: 'visible', timeout: 20000 })
      await page.locator('#start').waitFor({ state: 'visible' })
      await page.locator('#game canvas').waitFor({ state: 'attached' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(800)
    } catch (error) {
      throw Object.assign(new Error(`App did not render its playable start screen (${name}): ${error.message}`), { exitCode: 1 })
    }
    const rendered = await page.evaluate(() => {
      const menu = document.querySelector('.menu')
      const button = document.querySelector('#start')
      const canvas = document.querySelector('#game canvas')
      const canvasRect = canvas?.getBoundingClientRect()
      return {
        title: document.title,
        heading: menu?.querySelector('h1')?.innerText,
        menu: !!menu && getComputedStyle(menu).visibility !== 'hidden' && getComputedStyle(menu).display !== 'none',
        button: !!button && getComputedStyle(button).visibility !== 'hidden' && button.getBoundingClientRect().width > 0,
        canvas: !!canvas && canvas.width > 0 && canvas.height > 0 && canvasRect.width > 0 && canvasRect.height > 0
      }
    })
    if (!rendered.menu || !rendered.button || !rendered.canvas || !rendered.heading) throw Object.assign(new Error(`Rendered content checks failed (${name}): ${JSON.stringify(rendered)}`), { exitCode: 1 })
    if (renderErrors.length) throw Object.assign(new Error(`Browser rendering error (${name}): ${renderErrors.join('; ')}`), { exitCode: 1 })
    try { await page.screenshot({ path: join(output, `final-${name}.png`), fullPage: true, timeout: 30000 }) }
    catch (error) { throw browser.isConnected() ? Object.assign(error, { exitCode: 1 }) : transient(error) }
    console.log(`Captured ${name}  (${viewport.width}x${viewport.height}) ${url}`)
    await page.close()
  }
} catch (error) {
  console.error(error)
  exitCode = error.exitCode || 1
} finally {
  if (browser) {
    try { await browser.close() }
    catch (error) { console.error(error); if (!exitCode) exitCode = 75 }
  }
}
process.exitCode = exitCode
NODE