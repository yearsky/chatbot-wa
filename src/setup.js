// Wizard setup interaktif di terminal (cmd / PowerShell / bash).

import chalk from 'chalk'
import { confirm, input, password, select } from '@inquirer/prompts'
import { PROVIDERS, createAi } from './ai/index.js'
import { cliVersion } from './ai/cli.js'
import { listOpenAiModels } from './ai/openaiApi.js'
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

  const timezone = await input({
    message: 'Zona waktu (IANA):',
    default: prev.timezone,
    validate: (v) => isValidTimezone(v.trim()) || 'Zona waktu tidak dikenal, contoh: Asia/Jakarta, Asia/Makassar, Asia/Jayapura'
  }).then((v) => v.trim())

  const config = { ...prev, provider, model, ownerNumber, timezone }
  saveConfig(config)
  console.log(chalk.green(`\n✔ Konfigurasi disimpan ke ${PATHS.config}`))

  if (provider !== 'none' && (await confirm({ message: 'Tes koneksi AI sekarang?', default: true }))) {
    await testAi(config)
  }
  return config
}

export async function testAi(config) {
  try {
    const ai = createAi(config, { cwd: PATHS.data })
    process.stdout.write(chalk.gray(`Menghubungi ${ai.name}... `))
    const out = await ai.complete('Balas hanya dengan JSON persis ini: {"ok": true}')
    console.log(/"ok"\s*:\s*true/.test(out) ? chalk.green('berhasil ✔') : chalk.yellow(`respons tak terduga: ${out.slice(0, 200)}`))
  } catch (err) {
    console.log(chalk.red(`gagal ✖\n${err.message}`))
  }
}
