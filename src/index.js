#!/usr/bin/env node
// Entry point: `npm start` (setup otomatis jika belum ada config), `npm run setup`, `npm run logout`.

import fs from 'node:fs'
import chalk from 'chalk'
import dotenv from 'dotenv'
import { PROVIDERS, createAi } from './ai/index.js'
import { createAssistant } from './assistant.js'
import { PATHS, loadConfig } from './config.js'
import { Store } from './db.js'
import { createScheduler } from './scheduler.js'
import { runSetup } from './setup.js'
import { startWhatsApp } from './wa.js'

dotenv.config({ path: PATHS.env, quiet: true })

const COLORS = { info: chalk.cyan, success: chalk.green, warn: chalk.yellow, error: chalk.red }
function log(level, message) {
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false })
  console.log(`${chalk.gray(time)} ${(COLORS[level] || chalk.white)(message)}`)
}

const args = new Set(process.argv.slice(2))

if (args.has('--logout')) {
  fs.rmSync(PATHS.auth, { recursive: true, force: true })
  log('success', 'Sesi WhatsApp dihapus. Jalankan `npm start` untuk scan QR baru.')
  log('info', 'Hapus juga perangkat lama di HP: WhatsApp → Perangkat Tertaut.')
  process.exit(0)
}

let config = loadConfig()
try {
  if (!config || args.has('--setup')) {
    config = await runSetup(config)
    if (args.has('--setup')) process.exit(0)
  }
} catch (err) {
  // Ctrl+C di tengah wizard
  if (err?.name === 'ExitPromptError') process.exit(0)
  throw err
}

if (!config.ownerNumber) {
  log('error', 'Nomor pemilik belum diisi. Jalankan: npm run setup')
  process.exit(1)
}

console.log(chalk.cyan.bold('\n🤖 Asisten Pribadi WhatsApp'))
console.log(chalk.gray(`   AI      : ${PROVIDERS[config.provider] || config.provider}${config.model ? ` · model ${config.model}` : ''}`))
console.log(chalk.gray(`   Pemilik : ${config.ownerNumber}`))
console.log(chalk.gray(`   Zona    : ${config.timezone}`))
console.log(chalk.gray(`   Data    : ${PATHS.db}`))
console.log(chalk.gray('   Ubah pengaturan: npm run setup · Berhenti: Ctrl+C\n'))

fs.mkdirSync(PATHS.data, { recursive: true })
const store = new Store(PATHS.db)

let ai = null
try {
  ai = createAi(config, { cwd: PATHS.data })
} catch (err) {
  log('warn', `AI tidak aktif: ${err.message}`)
}

const assistant = createAssistant({ store, ai, tz: config.timezone, log })

const wa = startWhatsApp({
  authDir: PATHS.auth,
  ownerNumber: config.ownerNumber,
  log,
  async onMessage({ text, chatJid, msg }) {
    log('info', `← ${text.length > 80 ? text.slice(0, 80) + '…' : text}`)
    await wa.typing(chatJid, true)
    let reply
    try {
      reply = await assistant.handle(text)
    } finally {
      await wa.typing(chatJid, false)
    }
    await wa.sendText(chatJid, reply, msg)
    log('info', `→ ${reply.split('\n')[0]}`)
  }
})

const scheduler = createScheduler({ store, tz: config.timezone, log, send: (text) => wa.sendToOwner(text) })

wa.start()
scheduler.start()

async function shutdown() {
  log('info', 'Mematikan bot...')
  scheduler.stop()
  await wa.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (err) => log('error', `Unhandled: ${err?.message || err}`))
