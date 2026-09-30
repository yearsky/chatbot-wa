// Provider: OpenAI Codex CLI (`codex exec`), memakai login akun ChatGPT di komputer ini (tanpa API key).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCli } from './cli.js'

export function createCodexCli({ bin = 'codex', model, timeoutMs, cwd }) {
  return {
    name: 'Codex CLI',
    async complete(prompt) {
      const outFile = path.join(os.tmpdir(), `wa-assistant-codex-${process.pid}-${Date.now()}.txt`)
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--sandbox', 'read-only',
        '--ephemeral',
        '--color', 'never',
        '--output-last-message', outFile
      ]
      if (model) args.push('--model', model)
      args.push('-') // baca prompt dari stdin
      try {
        const { stdout } = await runCli(bin, args, { input: prompt, timeoutMs, cwd })
        const last = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim() : ''
        return last || stdout
      } finally {
        fs.rmSync(outFile, { force: true })
      }
    }
  }
}
