import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const debugPort = 9400 + Math.floor(Math.random() * 400)
const pageUrl = process.env.ACE_QA_URL || 'http://127.0.0.1:5173/'
const profilePath = mkdtempSync(join(tmpdir(), 'ace-responsive-'))
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profilePath}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true })

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

async function target() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())
      const page = targets.find((item) => item.type === 'page')
      if (page) return page
    } catch {
      // Chrome is still starting.
    }
    await wait(100)
  }
  throw new Error('Chrome DevTools did not become ready.')
}

try {
  const page = await target()
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const browserErrors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? 'Uncaught browser exception')
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') browserErrors.push(message.params.args?.map((argument) => argument.value ?? argument.description).join(' ') ?? 'Browser console error')
    if (!message.id || !pending.has(message.id)) return
    const { resolveResult, rejectResult } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectResult(new Error(message.error.message))
    else resolveResult(message.result)
  })
  const send = (method, params = {}) => new Promise((resolveResult, rejectResult) => {
    const id = ++nextId
    pending.set(id, { resolveResult, rejectResult })
    socket.send(JSON.stringify({ id, method, params }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: pageUrl })
  await wait(1000)
  if (pageUrl.startsWith('https://ace-er-scheduling.vercel.app')) {
    await send('Runtime.evaluate', {
      expression: `(async () => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'DEMO' }) }).then(response => response.ok))()`,
      awaitPromise: true,
      returnByValue: true,
    })
  }
  for (const [width, height] of [[360, 800], [768, 900], [1440, 1000]]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 360,
      screenWidth: width,
      screenHeight: height,
    })
    await send('Page.navigate', { url: pageUrl })
    await wait(1200)
    if (!pageUrl.startsWith('https://ace-er-scheduling.vercel.app')) {
      await send('Runtime.evaluate', {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Fill demo account')); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(100)
      await send('Runtime.evaluate', {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Sign in'); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(500)
    }
    if (process.env.ACE_QA_VIEW === 'tutorial' || process.env.ACE_QA_VIEW === 'tutorial-prompt') {
      await send('Runtime.evaluate', {
        expression: `(() => { const button = document.querySelector('button[aria-label="Help"]'); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(200)
      if (process.env.ACE_QA_VIEW === 'tutorial') {
        await send('Runtime.evaluate', {
          expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Start tutorial')); button?.click(); return Boolean(button) })()`,
          returnByValue: true,
        })
        await wait(250)
        const tutorialStep = Math.max(1, Number.parseInt(process.env.ACE_QA_TUTORIAL_STEP || '1', 10) || 1)
        for (let step = 1; step < tutorialStep; step += 1) {
          await send('Runtime.evaluate', {
            expression: `(() => { const button = [...document.querySelectorAll('.tutorial-card button')].find((item) => item.textContent?.trim().startsWith('Next')); button?.click(); return Boolean(button) })()`,
            returnByValue: true,
          })
          await wait(450)
        }
      }
    } else if (process.env.ACE_QA_VIEW === 'overtime' || process.env.ACE_QA_VIEW === 'overtime-afternoon') {
      await send('Runtime.evaluate', {
        expression: process.env.ACE_QA_VIEW === 'overtime-afternoon'
          ? `(() => { const card = [...document.querySelectorAll('.coverage-card')].find((item) => item.textContent?.includes('2 Afternoon')); const button = card?.querySelector('button'); button?.click(); return Boolean(button) })()`
          : `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Assign forced overtime')); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(300)
      await send('Runtime.evaluate', {
        expression: `(() => { const cell = document.querySelector('.shift-cell.overtime'); cell?.scrollIntoView({ block: 'center', inline: 'center' }); return Boolean(cell) })()`,
        returnByValue: true,
      })
      await wait(200)
    } else if (process.env.ACE_QA_VIEW === 'team' || process.env.ACE_QA_VIEW === 'add-nurse') {
      await send('Runtime.evaluate', {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Nurses team')); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(250)
      if (process.env.ACE_QA_VIEW === 'add-nurse') {
        await send('Runtime.evaluate', {
          expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Add nurse'); button?.click(); return Boolean(button) })()`,
          returnByValue: true,
        })
        await wait(250)
      }
    } else if (process.env.ACE_QA_VIEW === 'preferences' || process.env.ACE_QA_VIEW === 'preferences-dialog') {
      await send('Runtime.evaluate', {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith('Preferences')); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(250)
      if (process.env.ACE_QA_VIEW === 'preferences-dialog') {
        await send('Runtime.evaluate', {
          expression: `(() => { const button = document.querySelector('button[aria-label^="Edit requests for"]'); button?.click(); return Boolean(button) })()`,
          returnByValue: true,
        })
        await wait(250)
      }
    } else if (process.env.ACE_QA_VIEW === 'rules' || process.env.ACE_QA_VIEW === 'rules-dialog') {
      await send('Runtime.evaluate', {
        expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Coverage rules')); button?.click(); return Boolean(button) })()`,
        returnByValue: true,
      })
      await wait(250)
      if (process.env.ACE_QA_VIEW === 'rules-dialog') {
        await send('Runtime.evaluate', {
          expression: `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Edit rules'); button?.click(); return Boolean(button) })()`,
          returnByValue: true,
        })
        await wait(150)
        await send('Runtime.evaluate', {
          expression: `(() => { const button = document.querySelector('.override-section button'); button?.click(); return Boolean(button) })()`,
          returnByValue: true,
        })
        await wait(150)
        if (width <= 360) {
          await send('Runtime.evaluate', { expression: `(() => { const dialog = document.querySelector('.rules-dialog'); if (dialog) dialog.scrollTop = dialog.scrollHeight; return Boolean(dialog) })()` })
          await wait(100)
        }
      }
    }
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    })
    writeFileSync(resolve(`ace-${width}.png`), Buffer.from(data, 'base64'))
  }
  if (browserErrors.length) throw new Error(`Browser errors:\n${[...new Set(browserErrors)].join('\n')}`)
  socket.close()
} finally {
  if (chrome.exitCode === null) {
    const exited = new Promise((resolveExit) => chrome.once('exit', resolveExit))
    chrome.kill()
    await Promise.race([exited, wait(2000)])
  }
  try {
    rmSync(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (error) {
    if (error?.code !== 'EPERM') throw error
  }
}
