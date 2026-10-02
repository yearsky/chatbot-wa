// Perintah berbasis MCP, mis. "/atlassian <kata kunci>": menjalankan `claude -p` sekali jalan
// dengan server MCP tertentu dan HANYA tool baca yang diizinkan.
// File .mcp.json tidak pernah dibaca bot; path-nya langsung diteruskan ke Claude Code.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { killTree, spawnCli, spawnErrorMessage } from './cli.js'

// Preset read-only untuk server Atlassian (Jira, Confluence & Bitbucket).
export const ATLASSIAN_PRESET = {
  server: 'atlassian',
  label: 'Atlassian (Jira, Confluence & Bitbucket)',
  allowedTools: [
    'jira_search_jql',
    'jira_get_issue',
    'jira_list_projects',
    'confluence_search_cql',
    'confluence_get_page',
    'confluence_get_spaces',
    'bitbucket_get_repositories',
    'bitbucket_get_branches',
    'bitbucket_get_pull_requests',
    'bitbucket_get_pull_request',
    'bitbucket_get_commits',
    'bitbucket_get_file_content'
  ],
  // Lapisan pengaman tambahan: tool yang mengubah data diblokir eksplisit.
  deniedTools: [
    'jira_create_issue',
    'jira_update_issue',
    'jira_delete_issue',
    'jira_transition_issue',
    'jira_add_comment',
    'confluence_create_page',
    'confluence_update_page',
    'confluence_delete_page',
    'bitbucket_create_branch',
    'bitbucket_create_pull_request',
    'bitbucket_merge_pull_request',
    'bamboo_trigger_build',
    'bamboo_trigger_deployment'
  ]
}

// Tool bawaan Claude Code diblokir supaya model tidak bisa membaca file lokal (mis. config berisi kredensial).
const BUILTIN_DENIED = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task']

const MAX_REPLY_CHARS = 3500

// Untuk server MCP yang berjalan terpisah dalam mode HTTP: file config hanya berisi URL.
export function writeHttpMcpConfig(file, server, url) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { [server]: { type: 'http', url } } }, null, 2) + '\n')
}

export function mcpSystemPrompt(label) {
  return (
    `Kamu asisten ${label} untuk pemilik lewat WhatsApp. ` +
    'Permintaan pengguna bisa berupa kata kunci, pertanyaan, atau link halaman/issue. ' +
    'Untuk kata kunci, cari lalu tampilkan maksimal 10 hasil paling relevan, masing-masing dengan key atau judul, status bila ada, dan link. ' +
    'Untuk link, ambil halaman, issue, repo, pull request, atau file itu (ID, key, project, repo, atau path ada di URL) lalu jelaskan atau rangkum sesuai permintaan. ' +
    'Untuk isi file kode, jelaskan maksudnya dan kutip hanya potongan yang relevan, jangan kirim seluruh file. ' +
    'Untuk pertanyaan, cari informasi yang relevan lalu jawab langsung dan sebutkan sumbernya. ' +
    'Jawab dalam bahasa Indonesia yang ringkas. Format untuk WhatsApp: pakai *tebal* dan daftar bernomor, tanpa tabel dan tanpa heading markdown. ' +
    'Kamu hanya boleh membaca, jangan pernah mengubah data. ' +
    // Tool atlassian-mcp punya parameter auth opsional yang MENGGANTIKAN kredensial dari config server.
    'JANGAN PERNAH mengisi parameter auth, username, password, atau token pada tool; biarkan kosong karena server sudah memakai kredensial dari config-nya. ' +
    'Jika tool mengembalikan error autentikasi, laporkan pesan error aslinya apa adanya secara singkat. ' +
    'Jangan pernah menampilkan password, token, atau kredensial apa pun. ' +
    'Jika tidak ada hasil, katakan begitu dan sarankan kata kunci lain.'
  )
}

export function mcpArgs(cmd, model) {
  const prefix = `mcp__${cmd.server}__`
  const allowed = cmd.allowedTools.map((t) => (t.startsWith('mcp__') ? t : prefix + t))
  const denied = [...(cmd.deniedTools || []).map((t) => (t.startsWith('mcp__') ? t : prefix + t)), ...BUILTIN_DENIED]
  const args = [
    '-p',
    // stream-json + verbose memberi event "init" berisi status tiap server MCP (connected/failed).
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--system-prompt', mcpSystemPrompt(cmd.label || cmd.server),
    '--mcp-config', cmd.mcpConfig,
    '--strict-mcp-config',
    '--allowedTools', allowed.join(','),
    '--disallowedTools', denied.join(',')
  ]
  if (model) args.push('--model', model)
  // Matikan semua tool bawaan; tool MCP yang diizinkan tetap tersedia (sudah diuji).
  // --tools menerima banyak nilai, jadi taruh paling akhir.
  args.push('--tools', '')
  return args
}

// Pesan error yang bisa ditindaklanjuti bila server MCP tidak tersambung.
export function mcpConnectError(cmd, status) {
  const where = cmd.url ? `URL ${cmd.url}` : `file ${cmd.mcpConfig}`
  const head = status
    ? `Server MCP "${cmd.server}" gagal tersambung (status: ${status}) dari ${where}.`
    : `Server MCP "${cmd.server}" tidak ada di ${where}.`
  const hint = cmd.url
    ? 'Tidak ada server MCP yang berjalan di URL itu. Kalau server Atlassian-mu dipakai lewat .mcp.json (mode stdio), ' +
      'jalankan `npm run setup` dan isi path file .mcp.json-nya (mis. D:\\nds\\.mcp.json), bukan URL.'
    : 'Cek nama server & isi file config itu, lalu coba jalankan server tersebut dari Claude Code biasa.'
  return new Error(`${head}\n${hint}`)
}

export function createMcpRunner({ bin = 'claude', model, cwd, timeoutMs = 300000, log = () => {} }) {
  return {
    run(cmd, query) {
      if (!fs.existsSync(cmd.mcpConfig)) {
        return Promise.reject(new Error(`File MCP config tidak ditemukan: ${cmd.mcpConfig}. Jalankan: npm run setup`))
      }
      return new Promise((resolve, reject) => {
        let child
        try {
          child = spawnCli(bin, mcpArgs(cmd, cmd.model || model), { cwd })
        } catch (err) {
          reject(err)
          return
        }
        let settled = false
        let stderr = ''
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          killTree(child)
          fn(value)
        }
        const timer = setTimeout(
          () => finish(reject, new Error(`Pencarian tidak selesai dalam ${Math.round(timeoutMs / 1000)} detik`)),
          timeoutMs
        )

        readline.createInterface({ input: child.stdout }).on('line', (line) => {
          let ev
          try {
            ev = JSON.parse(line)
          } catch {
            return
          }
          if (ev.type === 'system' && ev.subtype === 'init') {
            const server = (ev.mcp_servers || []).find((s) => s.name === cmd.server)
            log('info', `MCP ${cmd.server}: ${server?.status ?? 'tidak ditemukan'}`)
            // Hentikan lebih awal: tanpa server, Claude hanya akan menjawab "tidak bisa akses".
            if (server?.status !== 'connected') finish(reject, mcpConnectError(cmd, server?.status))
          } else if (ev.type === 'result') {
            if (ev.is_error) return finish(reject, new Error(`Claude error: ${ev.result || ev.subtype || 'tidak diketahui'}`))
            const text = String(ev.result ?? '').trim()
            finish(resolve, text.length > MAX_REPLY_CHARS ? text.slice(0, MAX_REPLY_CHARS) + '\n\n_(dipotong, hasil terlalu panjang)_' : text)
          }
        })
        child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
        child.on('error', (err) => finish(reject, new Error(spawnErrorMessage(bin, err))))
        child.on('close', (code) => {
          const detail = stderr.trim().split('\n').slice(-3).join('\n')
          finish(reject, new Error(`${bin} berhenti tanpa hasil (kode ${code})${detail ? `: ${detail}` : ''}`))
        })
        child.stdin.on('error', () => {})
        child.stdin.end(`Permintaan pengguna: ${query}`)
      })
    }
  }
}
