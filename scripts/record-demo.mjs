import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const pageUrl = process.env.HANDLED_DEMO_URL || 'http://127.0.0.1:5173/'
const profile = mkdtempSync(join(tmpdir(), 'handled-video-'))
const port = 9500 + Math.floor(Math.random() * 400)
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true })
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

async function connect() {
  let target
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((page) => page.type === 'page')
      if (target) break
    } catch { /* Chrome is starting. */ }
    await wait(100)
  }
  if (!target) throw new Error('Chrome DevTools did not start')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', fail, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { done, fail } = pending.get(message.id)
    pending.delete(message.id)
    message.error ? fail(new Error(message.error.message)) : done(message.result)
  })
  return {
    send: (method, params = {}) => new Promise((done, fail) => {
      const requestId = ++id
      pending.set(requestId, { done, fail })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    }),
    close: () => socket.close(),
  }
}

async function record(send, name, width, height, scenes) {
  const frames = join(profile, name)
  mkdirSync(frames)
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 500,
    screenWidth: width, screenHeight: height,
  })
  await send('Page.navigate', { url: pageUrl })
  await wait(1200)
  await send('Runtime.evaluate', { expression: `(() => { document.querySelectorAll('button').forEach((button) => { if (button.textContent?.includes('Fill demo account')) button.click() }); return true })()` })
  await send('Runtime.evaluate', { expression: `(() => { document.querySelectorAll('button').forEach((button) => { if (button.textContent?.trim() === 'Sign in') button.click() }); return true })()` })
  await wait(700)
  let frame = 0
  for (const scene of scenes) {
    if (scene) {
      const result = await send('Runtime.evaluate', {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(${JSON.stringify(scene)})); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      if (!result.result.value) throw new Error(`Missing navigation button: ${scene}`)
      await wait(350)
    }
    for (let step = 0; step < 16; step += 1) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
      writeFileSync(join(frames, `${String(frame++).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
      await wait(200)
    }
  }
  const output = resolve(`docs/videos/${name}.mp4`)
  const encoded = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', '5', '-i', join(frames, '%04d.png'),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', output,
  ], { encoding: 'utf8', windowsHide: true })
  if (encoded.status !== 0) throw new Error(encoded.stderr || 'ffmpeg failed')
  return output
}

try {
  mkdirSync(resolve('docs/videos'), { recursive: true })
  const browser = await connect()
  try {
    await browser.send('Page.enable')
    const desktop = await record(browser.send, 'desktop-tour', 1280, 720, ['', 'Preferences', 'Nurses team', 'Coverage rules', 'Two-week schedule'])
    const mobile = await record(browser.send, 'mobile-tour', 390, 844, ['', 'Preferences', 'Two-week schedule'])
    process.stdout.write(`${desktop}\n${mobile}\n`)
  } finally {
    browser.close()
  }
} finally {
  if (chrome.exitCode === null) {
    const exited = new Promise((done) => chrome.once('exit', done))
    chrome.kill()
    await Promise.race([exited, wait(2000)])
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (error) {
    if (error?.code !== 'EPERM') throw error
  }
}
