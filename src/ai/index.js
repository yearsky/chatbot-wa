// Memilih provider AI berdasarkan config.json.

import { createClaudeCli } from './claudeCli.js'
import { createCodexCli } from './codexCli.js'
import { createMcpRunner } from './mcpQuery.js'
import { createOpenAiApi } from './openaiApi.js'

export const PROVIDERS = {
  'claude-cli': 'Claude Code CLI (akun Claude, tanpa API key)',
  'codex-cli': 'Codex CLI (akun ChatGPT, tanpa API key)',
  'openai-api': 'OpenAI API (pakai API key, bayar per pemakaian)',
  none: 'Tanpa AI (hanya perintah /...)'
}

export function createAi(config, { cwd, persistent = true, log } = {}) {
  const common = { model: config.model || undefined, timeoutMs: config.aiTimeoutMs || 120000, cwd }
  switch (config.provider) {
    case 'claude-cli':
      return createClaudeCli({
        ...common,
        bin: config.claudeBin || 'claude',
        persistent,
        maxTurns: config.claudeMaxTurns,
        log
      })
    case 'codex-cli':
      return createCodexCli({ ...common, bin: config.codexBin || 'codex' })
    case 'openai-api':
      return createOpenAiApi({ ...common, apiKey: process.env.OPENAI_API_KEY })
    default:
      return null
  }
}

// Perintah MCP (mis. /atlassian) selalu memakai Claude Code CLI, apa pun provider utamanya.
export function createMcp(config, { cwd, log } = {}) {
  if (!Object.keys(config.mcpCommands || {}).length) return null
  return createMcpRunner({ bin: config.claudeBin || 'claude', model: config.model || undefined, cwd, log })
}
