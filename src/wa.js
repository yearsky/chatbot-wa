// Koneksi WhatsApp via Baileys: login QR di terminal, auto-reconnect, dan filter pesan pemilik.

import fs from 'node:fs'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidStatusBroadcast,
  isLidUser,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState
} from 'baileys'

export function extractText(message) {
  const content = normalizeMessageContent(message)
  if (!content) return ''
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim()
}

const phoneOf = (jid) => (jid ? jidNormalizedUser(jid).split('@')[0] : '')

export function startWhatsApp({ authDir, ownerNumber, onMessage, log }) {
  const ownerJid = `${ownerNumber}@s.whatsapp.net`
  const sentIds = new Set() // ID pesan yang dikirim bot (agar tidak membalas diri sendiri)
  let sock = null
  let ready = false
  let stopped = false
  let retry = 0
  let watchdog = null
  const CONNECT_WATCHDOG_MS = 60000

  function rememberSent(msg) {
    const id = msg?.key?.id
    if (!id) return
    sentIds.add(id)
    if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value)
  }

  // Pastikan pengirim adalah pemilik. Baileys v7 bisa memberi JID berformat LID,
  // jadi cek juga JID alternatif (nomor telepon) dan mapping LID→PN.
  async function isFromOwner(key) {
    const candidates = [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt].filter(Boolean)
    if (candidates.some((j) => phoneOf(j) === ownerNumber && !isLidUser(j))) return true
    for (const j of candidates) {
      if (!isLidUser(j)) continue
      try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(j)
        if (pn && phoneOf(pn) === ownerNumber) return true
      } catch {
        // abaikan, anggap bukan pemilik
      }
    }
    return false
  }

  async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version, error } = await fetchLatestBaileysVersion()
    if (error) log('warn', 'Tidak bisa cek versi WhatsApp Web terbaru, memakai versi bawaan.')

    log('info', 'Menghubungkan ke WhatsApp...')
    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      // Identitas "Desktop" ditolak server saat pairing QR (kode 428); "Chrome" diterima.
      browser: process.platform === 'win32' ? Browsers.windows('Chrome') : Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)

    // Jika tidak ada QR maupun koneksi dalam 60 detik (mis. jaringan/firewall memblokir), paksa ulang.
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      if (ready || stopped) return
      log('warn', 'Belum ada respons dari WhatsApp. Cek koneksi internet/firewall. Mencoba ulang...')
      sock.end(new Error('connect watchdog'))
    }, CONNECT_WATCHDOG_MS)

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        clearTimeout(watchdog)
        log('info', 'Scan QR di bawah dengan WhatsApp: Perangkat Tertaut → Tautkan Perangkat')
        qrcode.generate(qr, { small: true })
      }
      if (connection === 'open') {
        clearTimeout(watchdog)
        ready = true
        retry = 0
        const me = phoneOf(sock.user?.id)
        log('success', `WhatsApp terhubung sebagai ${me}. Hanya pesan dari ${ownerNumber} yang dilayani.`)
        if (me === ownerNumber) {
          log('info', 'Bot memakai nomor pemilik sendiri: kirim perintah lewat chat "Kirim pesan ke diri sendiri".')
        }
      }
      if (connection === 'close') {
        ready = false
        if (stopped) return
        const code = lastDisconnect?.error?.output?.statusCode
        if (code === DisconnectReason.loggedOut) {
          log('warn', 'Sesi WhatsApp logout. Menghapus sesi lama, QR baru akan muncul...')
          fs.rmSync(authDir, { recursive: true, force: true })
          setTimeout(() => connect().catch(fatal), 1000)
          return
        }
        const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(30000, 2000 * 2 ** retry++)
        log('warn', `Koneksi terputus (kode ${code ?? '-'}), mencoba lagi dalam ${Math.round(delay / 1000)} detik...`)
        setTimeout(() => connect().catch(fatal), delay)
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      const me = phoneOf(sock.user?.id)
      for (const msg of messages) {
        try {
          const { key } = msg
          if (!key?.remoteJid || !msg.message) continue
          if (isJidGroup(key.remoteJid) || isJidStatusBroadcast(key.remoteJid)) continue
          if (sentIds.has(key.id)) continue
          // Pesan fromMe hanya dilayani jika bot memakai nomor pemilik sendiri (chat ke diri sendiri).
          if (key.fromMe && me !== ownerNumber) continue
          if (key.fromMe) {
            const myLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null
            const selfChat = [key.remoteJid, key.remoteJidAlt]
              .filter(Boolean)
              .some((j) => (isLidUser(j) ? jidNormalizedUser(j) === myLid : phoneOf(j) === me))
            if (!selfChat) continue
          } else if (!(await isFromOwner(key))) {
            continue
          }

          const text = extractText(msg.message)
          if (!text) continue
          await onMessage({ text, chatJid: key.remoteJid, msg })
        } catch (err) {
          log('error', `Gagal memproses pesan: ${err.message}`)
        }
      }
    })
  }

  function fatal(err) {
    log('error', `Gagal menyambung ke WhatsApp: ${err.message}`)
    if (!stopped) setTimeout(() => connect().catch(fatal), 10000)
  }

  async function sendText(jid, text, quoted) {
    if (!ready || !sock) throw new Error('WhatsApp belum terhubung')
    const sent = await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined)
    rememberSent(sent)
    return sent
  }

  return {
    start: () => connect().catch(fatal),
    isReady: () => ready,
    sendText,
    sendToOwner: (text) => sendText(ownerJid, text),
    async typing(jid, on) {
      try {
        await sock?.sendPresenceUpdate(on ? 'composing' : 'paused', jid)
      } catch {
        // indikator mengetik tidak penting
      }
    },
    async stop() {
      stopped = true
      clearTimeout(watchdog)
      try {
        sock?.end(undefined)
      } catch {
        // abaikan
      }
    }
  }
}
