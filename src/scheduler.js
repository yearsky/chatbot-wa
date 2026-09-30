// Loop pengecekan reminder jatuh tempo. Reminder disimpan di file, jadi tetap aman setelah restart;
// reminder yang terlewat saat komputer mati dikirim ketika bot hidup lagi dengan label "terlambat".

import { formatDateTime } from './time.js'

const LATE_THRESHOLD_MS = 5 * 60 * 1000

export function createScheduler({ store, send, tz, log = () => {}, clock = () => new Date(), intervalMs = 30000 }) {
  let timer = null
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
      const now = clock()
      for (const r of store.dueReminders(now)) {
        const due = new Date(r.dueAt)
        const late = now.getTime() - due.getTime() > LATE_THRESHOLD_MS
        const text =
          `⏰ *Reminder*${late ? ` (terlambat, jadwal ${formatDateTime(due, tz)})` : ''}\n` +
          `${r.text}\n\n_#${r.id}${r.repeat !== 'none' ? ' · balas /done ' + r.id + ' untuk menghentikan' : ''}_`
        try {
          await send(text)
        } catch (err) {
          // Biarkan tetap pending; dicoba lagi di tick berikutnya (mis. saat WA reconnect).
          log('warn', `Gagal mengirim reminder #${r.id}: ${err.message}`)
          break
        }
        store.afterFire(r.id, now, tz)
        log('info', `Reminder #${r.id} terkirim`)
      }
    } finally {
      running = false
    }
  }

  return {
    tick,
    start() {
      if (timer) return
      timer = setInterval(() => tick().catch((e) => log('error', e.message)), intervalMs)
      tick().catch((e) => log('error', e.message))
    },
    stop() {
      clearInterval(timer)
      timer = null
    }
  }
}
