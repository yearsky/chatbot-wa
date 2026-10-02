// Membuat "binary" palsu dari script fixture. Di Windows dibungkus file .cmd,
// sehingga test ikut melewati jalur cmd.exe + quoting yang dipakai bot sungguhan.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

export function fakeBin(fixture) {
  const script = path.join(FIXTURES, fixture)
  if (process.platform !== 'win32') return script
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-fakebin-'))
  const cmd = path.join(dir, fixture.replace(/\.js$/, '.cmd'))
  fs.writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  return cmd
}
