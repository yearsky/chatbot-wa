import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveMcpLocation } from '../src/setup.js'
import { writeHttpMcpConfig } from '../src/ai/mcpQuery.js'

test('resolveMcpLocation: file, folder, URL, dan input salah', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mcpcfg-'))
  const server = path.join(dir, 'atlassian-mcp')
  fs.mkdirSync(server)
  const cfg = path.join(dir, '.mcp.json')
  fs.writeFileSync(cfg, '{}')

  assert.deepEqual(resolveMcpLocation(cfg), { mcpConfig: cfg })
  assert.deepEqual(resolveMcpLocation(`"${cfg}"`), { mcpConfig: cfg }) // path ber-kutip dari Explorer
  assert.deepEqual(resolveMcpLocation(dir), { mcpConfig: cfg }) // folder yang berisi .mcp.json
  assert.match(resolveMcpLocation(server).error, /folder, bukan file/) // folder server (kasus di screenshot)
  assert.match(resolveMcpLocation(path.join(dir, 'tidak-ada.json')).error, /tidak ditemukan/)
  assert.deepEqual(resolveMcpLocation('http://127.0.0.1:9999/mcp'), { url: 'http://127.0.0.1:9999/mcp' })
  assert.match(resolveMcpLocation('http://').error, /URL tidak valid/)
  assert.match(resolveMcpLocation('  ').error, /Wajib/)
})

test('writeHttpMcpConfig hanya menyimpan URL', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mcphttp-')), 'mcp-atlassian.json')
  writeHttpMcpConfig(file, 'atlassian', 'http://127.0.0.1:9999/mcp')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    mcpServers: { atlassian: { type: 'http', url: 'http://127.0.0.1:9999/mcp' } }
  })
})
