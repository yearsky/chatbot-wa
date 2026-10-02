#!/usr/bin/env node
// Server MCP stdio minimal untuk pengujian: tool "search_issues" (baca) dan "delete_issue" (tulis).
// Setiap pemanggilan tool dicatat ke file di env FAKE_MCP_LOG.
import fs from 'node:fs'
import readline from 'node:readline'

const logFile = process.env.FAKE_MCP_LOG
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
const record = (line) => logFile && fs.appendFileSync(logFile, line + '\n')

const tools = [
  {
    name: 'search_issues',
    description: 'Cari issue berdasarkan kata kunci (read-only).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'delete_issue',
    description: 'Hapus issue berdasarkan key.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }
  }
]

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === 'initialize') {
    send({
      id: req.id,
      result: {
        protocolVersion: req.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '1.0.0' }
      }
    })
  } else if (req.method === 'tools/list') {
    send({ id: req.id, result: { tools } })
  } else if (req.method === 'tools/call') {
    record(`${req.params.name} ${JSON.stringify(req.params.arguments)}`)
    const text =
      req.params.name === 'search_issues'
        ? 'DEMO-1: Perbaikan sync kas (status: In Progress) https://example.test/DEMO-1\nDEMO-2: Laporan harian (status: Done) https://example.test/DEMO-2'
        : 'deleted'
    send({ id: req.id, result: { content: [{ type: 'text', text }] } })
  } else if (req.id !== undefined) {
    send({ id: req.id, result: {} })
  }
})
