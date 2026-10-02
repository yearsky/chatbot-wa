// Loop pengecekan reminder jatuh tempo. Reminder disimpan di file, jadi tetap aman setelah restart;
// reminder yang terlewat saat komputer mati dikirim ketika bot hidup lagi dengan label "terlambat".

import { formatWhen } from './time.js'

const LATE_THRESHOLD_MS = 5 * 60 * 1000

// "Hii Kai, aku mau remind minum air jangan lupa ya"
export function reminderMessage(r, now, tz, ownerName = '') {
  const due = new Date(r.dueAt)
  let msg = `Hii${ownerName ? ` ${ownerName}` : ''}, aku mau remind ${r.text} jangan lupa ya`
  if (now.getTime() - due.getTime() > LATE_THRESHOLD_MS) {
    msg += `\n_(harusnya ${formatWhen(due, now, tz)}, maaf telat karena bot sempat mati)_`
  }
  if (r.repeat !== 'none') msg += `\n_Balas /done ${r.id} kalau sudah tidak perlu diingatkan lagi._`
  return msg
}

export function createScheduler({ store, send, tz, ownerName = '', log = () => {}, clock = () => new Date(), intervalMs = 30000 }) {
  let timer = null
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
      const now = clock()
      for (const r of store.dueReminders(now)) {
        const text = reminderMessage(r, now, tz, ownerName)
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
