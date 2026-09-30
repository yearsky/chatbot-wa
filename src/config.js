// Lokasi file & pembacaan/penulisan config.json dan .env.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// WA_ASSISTANT_HOME bisa dipakai untuk memindahkan data ke folder lain.
export const HOME = path.resolve(process.env.WA_ASSISTANT_HOME || PROJECT_ROOT)

export const PATHS = {
  config: path.join(HOME, 'config.json'),
  env: path.join(HOME, '.env'),
  auth: path.join(HOME, 'auth'),
  data: path.join(HOME, 'data'),
  db: path.join(HOME, 'data', 'db.json')
}

export const DEFAULTS = {
  provider: 'claude-cli',
  model: '',
  ownerNumber: '',
  timezone: 'Asia/Jakarta',
  aiTimeoutMs: 120000
}

export function loadConfig() {
  if (!fs.existsSync(PATHS.config)) return null
  return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(PATHS.config, 'utf8')) }
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(PATHS.config), { recursive: true })
  fs.writeFileSync(PATHS.config, JSON.stringify(config, null, 2) + '\n')
}

// Tulis/ganti satu variabel di file .env tanpa menghapus isi lainnya.
export function setEnvVar(file, key, value) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []
  const entry = `${key}=${value}`
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
  if (idx >= 0) lines[idx] = entry
  else lines.push(entry)
  fs.writeFileSync(file, lines.filter((l) => l.trim() !== '').join('\n') + '\n')
}

// "0812-3456-789" → "628123456789"; "+62 812..." → "62812..."
export function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '')
  if (digits.startsWith('0')) digits = '62' + digits.slice(1)
  return digits
}

// Nama model dipakai sebagai argumen CLI, jadi batasi karakternya.
export function isSafeModelName(model) {
  return model === '' || /^[\w.:/-]+$/.test(model)
}
