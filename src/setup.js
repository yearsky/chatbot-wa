// Wizard setup interaktif di terminal (cmd / PowerShell / bash).

import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
import { confirm, input, password, select } from '@inquirer/prompts'
import { PROVIDERS, createAi } from './ai/index.js'
import { cliVersion } from './ai/cli.js'
import { ATLASSIAN_PRESET, writeHttpMcpConfig } from './ai/mcpQuery.js'
import { listOpenAiModels } from './ai/openaiApi.js'
import { buildPrompt, extractJson, validateIntent } from './ai/prompt.js'
import { DEFAULTS, PATHS, isSafeModelName, normalizePhone, saveConfig, setEnvVar } from './config.js'
import { isValidTimezone } from './time.js'

const MANUAL = '__manual__'

const CLI_INFO = {
  'claude-cli': {
    bin: 'claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude   (lalu ikuti proses login akun Claude di browser)'
  },
  'codex-cli': {
    bin: 'codex',
    install: 'npm install -g @openai/codex',
    login: 'codex login   (login dengan akun ChatGPT)'
  }
}

async function askModelManual(message, def = '') {
  return input({
    message,
    default: def,
    validate: (v) => isSafeModelName(v.trim()) || 'Hanya huruf, angka, dan . _ - : /'
  }).then((v) => v.trim())
}

async function chooseModel(provider, current) {
  if (provider === 'claude-cli') {
    const choice = await select({
      message: 'Pilih model Claude:',
      choices: [
        { name: 'Default (ikuti pengaturan Claude Code)', value: '' },
        { name: 'sonnet  — seimbang (disarankan)', value: 'sonnet' },
        { name: 'haiku   — paling cepat & hemat kuota', value: 'haiku' },
        { name: 'opus    — paling pintar, paling boros kuota', value: 'opus' },
        { name: 'Ketik manual (nama model lengkap)', value: MANUAL }
      ],
      default: current ?? 'sonnet'
    })
    return choice === MANUAL ? askModelManual('Nama model Claude:', current) : choice
  }

  if (provider === 'codex-cli') {
    const choice = await select({
      message: 'Pilih model Codex:',
      choices: [
        { name: 'Default (ikuti pengaturan Codex CLI)', value: '' },
        { name: 'Ketik manual', value: MANUAL }
      ],
      default: current ? MANUAL : ''
    })
    return choice === MANUAL ? askModelManual('Nama model (lihat `codex` → /model):', current) : choice
  }

  if (provider === 'openai-api') {
    let models = []
    try {
      process.stdout.write(chalk.gray('Mengambil daftar model dari OpenAI...\n'))
      models = await listOpenAiModels(process.env.OPENAI_API_KEY)
    } catch (err) {
      console.log(chalk.yellow(`Tidak bisa mengambil daftar model: ${err.message}`))
    }
    if (!models.length) return askModelManual('Nama model OpenAI (mis. lihat platform.openai.com/docs/models):', current)
    const choice = await select({
      message: 'Pilih model OpenAI:',
      choices: [...models.map((m) => ({ name: m, value: m })), { name: 'Ketik manual', value: MANUAL }],
      default: models.includes(current) ? current : undefined,
      pageSize: 15
    })
    return choice === MANUAL ? askModelManual('Nama model OpenAI:', current) : choice
  }

  return ''
}

export async function runSetup(existing) {
  const prev = { ...DEFAULTS, ...(existing || {}) }
  console.log(chalk.cyan.bold('\n⚙️  Setup Asisten Pribadi WhatsApp\n'))

  const provider = await select({
    message: 'Pilih penyedia AI:',
    choices: Object.entries(PROVIDERS).map(([value, name]) => ({ name, value })),
    default: prev.provider
  })

  const info = CLI_INFO[provider]
  if (info) {
    const version = await cliVersion(info.bin)
    if (version) {
      console.log(chalk.green(`✔ ${info.bin} terdeteksi: ${version}`))
    } else {
      console.log(chalk.yellow(`\n✖ Perintah "${info.bin}" tidak ditemukan. Instal & login dulu di terminal lain:`))
      console.log(`   ${chalk.bold(info.install)}`)
      console.log(`   ${chalk.bold(info.login)}\n`)
      const goOn = await confirm({ message: 'Lanjutkan setup tetap memakai provider ini?', default: true })
      if (!goOn) return runSetup(existing)
    }
  }

  if (provider === 'openai-api') {
    const hasKey = Boolean(process.env.OPENAI_API_KEY)
    const change = hasKey
      ? await confirm({ message: 'OPENAI_API_KEY sudah ada di .env. Ganti?', default: false })
      : true
    if (change) {
      const key = await password({ message: 'Masukkan OPENAI_API_KEY:', mask: '*', validate: (v) => v.trim().length > 10 || 'API key tidak valid' })
      setEnvVar(PATHS.env, 'OPENAI_API_KEY', key.trim())
      process.env.OPENAI_API_KEY = key.trim()
      console.log(chalk.gray(`Disimpan di ${PATHS.env} (jangan di-commit!)`))
    }
  }

  const model = await chooseModel(provider, prev.provider === provider ? prev.model : undefined)

  const ownerNumber = normalizePhone(
    await input({
      message: 'Nomor WhatsApp pemilik (yang boleh memakai bot), mis. 6281234567890:',
      default: prev.ownerNumber || undefined,
      validate: (v) => /^\d{8,15}$/.test(normalizePhone(v)) || 'Nomor tidak valid'
    })
  )

  const ownerName = await input({
    message: 'Nama panggilanmu (dipakai bot saat menyapa, boleh kosong):',
    default: prev.ownerName || undefined
  }).then((v) => v.trim())

  const timezone = await input({
    message: 'Zona waktu (IANA):',
    default: prev.timezone,
    validate: (v) => isValidTimezone(v.trim()) || 'Zona waktu tidak dikenal, contoh: Asia/Jakarta, Asia/Makassar, Asia/Jayapura'
  }).then((v) => v.trim())

  const mcpCommands = await askMcp(prev)

  const config = { ...prev, provider, model, ownerNumber, ownerName, timezone, mcpCommands }
  saveConfig(config)
  console.log(chalk.green(`\n✔ Konfigurasi disimpan ke ${PATHS.config}`))

  if (provider !== 'none' && (await confirm({ message: 'Tes koneksi AI sekarang?', default: true }))) {
    await testAi(config)
  }
  return config
}

/**
 * Terima path file .mcp.json, folder yang berisi .mcp.json, atau URL server MCP HTTP.
 * @returns {{ mcpConfig?: string, url?: string, error?: string }}
 */
export function resolveMcpLocation(raw) {
  const value = String(raw || '').trim().replace(/^"(.*)"$/, '$1')
  if (!value) return { error: 'Wajib diisi' }
  if (/^https?:\/\//i.test(value)) {
    try {
      return { url: new URL(value).toString() }
    } catch {
      return { error: 'URL tidak valid' }
    }
  }
  const full = path.resolve(value)
  if (!fs.existsSync(full)) return { error: 'File atau folder tidak ditemukan' }
  if (fs.statSync(full).isDirectory()) {
    const inside = path.join(full, '.mcp.json')
    if (fs.existsSync(inside)) return { mcpConfig: inside }
    return { error: 'Itu folder, bukan file config. Isi dengan file .mcp.json, mis. D:\\nds\\.mcp.json' }
  }
  return { mcpConfig: full }
}

// Perintah /atlassian lewat MCP. Bot tidak membaca isi file .mcp.json; path-nya diteruskan ke Claude Code.
async function askMcp(prev) {
  const mcpCommands = { ...(prev.mcpCommands || {}) }
  const existing = mcpCommands.atlassian
  if (!(await cliVersion(prev.claudeBin || 'claude'))) {
    if (existing) console.log(chalk.yellow('Claude Code CLI tidak terdeteksi, /atlassian tidak akan berfungsi.'))
    return mcpCommands
  }

  const enable = await confirm({
    message: 'Aktifkan perintah /atlassian (cari Jira, Confluence & Bitbucket lewat MCP, hanya baca)?',
    default: Boolean(existing)
  })
  if (!enable) {
    delete mcpCommands.atlassian
    return mcpCommands
  }

  console.log(
    chalk.gray(
      'Isi dengan FILE .mcp.json yang mendaftarkan server Atlassian (mode stdio, mis. D:\\nds\\.mcp.json),\n' +
        'atau URL bila server Atlassian dijalankan terpisah dalam mode HTTP (mis. http://127.0.0.1:9999/mcp).'
    )
  )
  const location = resolveMcpLocation(
    await input({
      message: 'File MCP config atau URL server Atlassian:',
      default: existing?.url || existing?.mcpConfig,
      validate: (v) => resolveMcpLocation(v).error ?? true
    })
  )

  let mcpConfig = location.mcpConfig
  let server
  if (location.url) {
    // Mode HTTP: buat file config kecil berisi URL saja (tanpa rahasia).
    server = ATLASSIAN_PRESET.server
    mcpConfig = path.join(PATHS.data, `mcp-${server}.json`)
    writeHttpMcpConfig(mcpConfig, server, location.url)
    console.log(chalk.gray(`Config MCP HTTP dibuat: ${mcpConfig}`))
  } else {
    server = await input({
      message: 'Nama server di file itu (kunci di "mcpServers", bukan URL):',
      default: existing?.server || ATLASSIAN_PRESET.server,
      validate: (v) => /^[\w-]+$/.test(v.trim()) || 'Hanya huruf, angka, _ dan - (contoh: atlassian)'
    }).then((v) => v.trim())
  }

  // Tool baru di preset (mis. Bitbucket) ikut ditambahkan ke config lama; tambahan manual tetap dipertahankan.
  const union = (a = [], b = []) => [...new Set([...a, ...b])]
  mcpCommands.atlassian = {
    ...ATLASSIAN_PRESET,
    ...existing,
    label: ATLASSIAN_PRESET.label,
    allowedTools: union(existing?.allowedTools, ATLASSIAN_PRESET.allowedTools),
    deniedTools: union(existing?.deniedTools, ATLASSIAN_PRESET.deniedTools),
    mcpConfig,
    server,
    url: location.url
  }
  if (!location.url) delete mcpCommands.atlassian.url
  console.log(chalk.gray(`Tool yang diizinkan (hanya baca): ${mcpCommands.atlassian.allowedTools.join(', ')}`))
  return mcpCommands
}

export async function testAi(config) {
  try {
    // Mode sekali jalan: tidak meninggalkan proses Claude yang menyala setelah setup.
    const ai = createAi(config, { cwd: PATHS.data, persistent: false })
    process.stdout.write(chalk.gray(`Menghubungi ${ai.name}... `))
    // Tes memakai prompt yang sama dengan pesan WhatsApp sungguhan.
    const now = new Date()
    const out = await ai.complete(buildPrompt({ message: 'catat: tes koneksi', now, tz: config.timezone }))
    let parsed = null
    try {
      parsed = validateIntent(extractJson(out), now)
    } catch {
      // ditangani di bawah
    }
    if (parsed?.ok && parsed.intent.action === 'add_note') console.log(chalk.green('berhasil ✔'))
    else console.log(chalk.yellow(`respons tak terduga: ${out.slice(0, 300)}`))
  } catch (err) {
    console.log(chalk.red(`gagal ✖\n${err.message}`))
  }
}
