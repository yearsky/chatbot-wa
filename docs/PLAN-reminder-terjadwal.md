# Planning: Reminder Terjadwal (Loop Hari & Jam)

Status: **draft planning**, belum diimplementasi.

## 1. Tujuan

Pemilik bisa membuat reminder yang berulang otomatis berdasarkan **rentang hari** dan **beberapa jam** sekaligus, lalu bot mengirim pesan WhatsApp di setiap jadwal itu.

Contoh kebutuhan:

> Senin–Jumat, kirim reminder jam **07:20** dan **17:00**.

Contoh pemakaian yang ditargetkan:

```
/remind senin-jumat 07:20,17:00 absen
/remind hari-kerja 07:20 absen masuk
/remind hari-kerja 17:00 absen pulang
/remind senin,rabu,jumat 06:00 olahraga
/remind sabtu-minggu 08:00 siram tanaman
```

Lewat AI (bahasa bebas):

```
ingatkan aku absen tiap senin sampai jumat jam 7.20 dan jam 5 sore
```

## 2. Kondisi kode saat ini

| Bagian | File | Keadaan sekarang |
|---|---|---|
| Model data | `src/db.js` | Reminder punya `dueAt` (satu waktu) dan `repeat`: `none` / `daily` / `weekly` |
| Hitung jadwal berikutnya | `src/time.js` → `nextOccurrence()` | Hanya maju +1 hari atau +7 hari dari `dueAt` |
| Pengirim | `src/scheduler.js` | Cek tiap 30 detik, kirim reminder yang `dueAt <= now`, lalu panggil `store.afterFire()` |
| Parser perintah | `src/commands.js` | `/remind [harian\|mingguan] <waktu> <teks>` |
| AI | `src/ai/prompt.js` | Skema JSON hanya kenal `repeat: none\|daily\|weekly` |

Arsitekturnya sudah cocok: scheduler cukup melihat `dueAt`. Jadi fitur ini cukup mengubah **cara menghitung `dueAt` berikutnya**. Loop pengirim tidak perlu dirombak.

## 3. Desain

### 3.1 Model data

Tambah jenis repeat baru `schedule`, dengan field `schedule`:

```json
{
  "id": 7,
  "text": "absen",
  "repeat": "schedule",
  "schedule": {
    "days": [1, 2, 3, 4, 5],
    "times": ["07:20", "17:00"]
  },
  "dueAt": "2026-10-02T00:20:00.000Z",
  "status": "pending",
  "createdAt": "..."
}
```

- `days`: nomor hari ISO, 1 = Senin … 7 = Minggu.
- `times`: jam dinding `HH:MM` di zona waktu config, diurutkan dan tanpa duplikat.
- `dueAt` tetap ada dan selalu berisi kejadian berikutnya, sehingga `dueReminders()`, `listReminders()` dan scheduler tetap jalan tanpa perubahan.
- **Satu reminder = satu ID** untuk semua jam. `/done 7` menghentikan seluruh jadwal (pagi dan sore).
- Reminder lama (`daily` / `weekly`) tidak diubah dan tidak perlu migrasi.

Kenapa satu entitas dan bukan satu reminder per jam? Supaya `/done`, `/del` dan daftar reminder tetap sederhana. Jika pesan pagi dan sore **berbeda**, cukup buat dua reminder (lihat contoh "absen masuk" / "absen pulang").

### 3.2 Hitung kejadian berikutnya (`src/time.js`)

Fungsi baru:

```js
// Kejadian pertama yang > after, sesuai days & times di zona tz.
export function nextScheduledOccurrence(schedule, after, tz)
```

Algoritma:

1. Ambil tanggal lokal `after` lewat `getZonedParts()`.
2. Loop `offset = 0..7` hari:
   - hitung tanggal lokal hari ke-`offset` dan nomor harinya (Senin = 1);
   - lewati jika hari tidak ada di `days`;
   - untuk tiap jam di `times` (urut): `zonedTimeToUtc(...)`; kembalikan yang pertama `> after`.
3. Jika tidak ketemu (seharusnya tidak mungkin bila `days` tidak kosong), kembalikan `null`.

Perlu helper kecil untuk nomor hari ISO dari tanggal lokal, mis. `Date.UTC(y, m-1, d)` → `getUTCDay()` → ubah 0 (Minggu) jadi 7. Cara ini menghindari ketergantungan pada string `weekday` dari `Intl`.

Lalu `nextOccurrence()` / `Store.afterFire()` memanggil fungsi ini bila `repeat === 'schedule'`.

### 3.3 Parser hari & jam (`src/time.js` atau file baru `src/schedule.js`)

`parseDays(token)` → array nomor hari, atau `null`:

| Input | Hasil |
|---|---|
| `senin-jumat`, `sen-jum`, `hari-kerja`, `weekdays` | `[1,2,3,4,5]` |
| `sabtu-minggu`, `weekend`, `akhir-pekan` | `[6,7]` |
| `setiap-hari`, `tiap-hari`, `harian` | `[1..7]` |
| `senin,rabu,jumat` | `[1,3,5]` |
| `jumat-senin` (melewati Minggu) | `[5,6,7,1]` |

Nama hari diterima dalam bentuk penuh dan singkat: `senin/sen`, `selasa/sel`, `rabu/rab`, `kamis/kam`, `jumat/jum'at/jum`, `sabtu/sab`, `minggu/min/ahad`, plus nama Inggris (`mon`…`sun`).

`parseTimes(token)` → `["07:20","17:00"]`, memakai `parseClock()` yang sudah ada. Pemisahnya koma, dan `.` juga diterima sebagai pemisah jam-menit (`7.20,17.00`).

Catatan: kata dua-token seperti `hari kerja` (pakai spasi) bisa didukung dengan menggabungkan dua token pertama sebelum parsing. Supaya parser sederhana, versi awal cukup mewajibkan bentuk berstrip (`hari-kerja`).

### 3.4 Perintah WhatsApp (`src/commands.js`)

Format:

```
/remind <hari> <jam[,jam...]> <teks>
```

Alur di `case 'remind'`:

1. Jika token pertama cocok dengan `parseDays()` → mode jadwal.
2. Token kedua wajib `parseTimes()`; sisanya adalah teks.
3. Hitung `dueAt = nextScheduledOccurrence(schedule, now, tz)`.
4. Hasilkan intent `{ action: 'add_reminder', text, dueAt, repeat: 'schedule', schedule }`.
5. Jika tidak cocok → jatuh ke alur lama (`harian`, `mingguan`, `parseWhen`).

Pesan error yang jelas, misalnya:
- `Jam tidak dikenali. Contoh: /remind senin-jumat 07:20,17:00 absen`
- `Isi reminder kosong.`

Perbarui `HELP_TEXT` dengan contoh baru.

### 3.5 Eksekusi & tampilan (`src/assistant.js`, `src/db.js`)

- `Store.addReminder(text, dueAt, repeat, now, schedule)` menyimpan field `schedule` jika ada.
- Label repeat di daftar:
  ```
  #7 · Jum, 2 Okt 2026, 07.20 🔁 Sen–Jum 07:20, 17:00
      absen
  ```
- Balasan konfirmasi menyebut jadwal dan kiriman pertama:
  ```
  ⏰ Oke, diingatkan Sen–Jum jam 07:20 & 17:00
  Kiriman pertama: Jum, 2 Okt 2026, 07.20
  #7 · absen
  ```
- Format ringkas hari: `[1..5]` → `Sen–Jum`, `[6,7]` → `Sab–Min`, `[1..7]` → `setiap hari`, lainnya → `Sen, Rab, Jum`.

### 3.6 Scheduler (`src/scheduler.js`)

Tidak perlu perubahan logika. Pesan yang terkirim sudah otomatis berisi `balas /done <id> untuk menghentikan` karena `repeat !== 'none'`.

Perilaku saat komputer/bot mati (sudah berlaku sekarang, tetap sama):
- Bot mati Jumat 16:00, nyala Senin 09:00 → jadwal Jumat 17:00 dikirim **sekali** dengan label "terlambat", lalu jadwal berikutnya dihitung dari sekarang (Senin 17:00). Jadwal yang terlewat di antaranya tidak dikirim beruntun.

Usulan tambahan (opsional, lihat Pertanyaan Terbuka): batas keterlambatan. Misalnya reminder "berangkat 07:20" yang baru terkirim jam 15:00 sudah tidak berguna, jadi lebih baik dilewati dan hanya dicatat di log.

### 3.7 AI (`src/ai/prompt.js`)

- Tambah `"schedule"` ke `REPEATS`.
- Tambah field di skema JSON:
  ```
  "days": number[] | null,   // untuk repeat "schedule": 1=Senin ... 7=Minggu
  "times": string[] | null   // untuk repeat "schedule": ["07:20","17:00"]
  ```
- Aturan prompt: "tiap/setiap <hari> … jam …" atau "senin sampai jumat" → `add_reminder` dengan `repeat: "schedule"`. `due_at` boleh `null` karena kode yang menghitungnya.
- `validateIntent()`: untuk `repeat === 'schedule'`, validasi `days` (1–7, tidak kosong) dan `times` (format `HH:MM`). `dueAt` dihitung oleh kode, **bukan** dari AI. Ini sesuai prinsip proyek: AI hanya menerjemahkan, kode yang menjadwalkan.
- `buildPrompt()`: tampilkan jadwal reminder aktif agar AI bisa memilih ID untuk `done`/`delete`.

## 4. Rencana pengerjaan (urutan commit)

| # | Langkah | File | Test |
|---|---|---|---|
| 1 | `parseDays`, `parseTimes`, `isoWeekday`, `nextScheduledOccurrence`, `formatSchedule` | `src/time.js` (atau `src/schedule.js`) | `test/time.test.js` |
| 2 | Simpan `schedule` dan dukung `repeat: 'schedule'` di `afterFire` | `src/db.js` | `test/store.test.js` |
| 3 | Perintah `/remind <hari> <jam,...> <teks>` + help | `src/commands.js` | `test/commands.test.js` |
| 4 | Label daftar & konfirmasi | `src/assistant.js` | `test/assistant.test.js` |
| 5 | Skema & validasi AI | `src/ai/prompt.js` | `test/prompt.test.js` |
| 6 | Dokumentasi | `README.md` | — |

Setiap langkah bisa di-commit dan dites terpisah (`npm test`).

## 5. Kasus uji penting

Zona `Asia/Jakarta`, jadwal Senin–Jumat 07:20 & 17:00:

| Sekarang (WIB) | Kejadian berikutnya yang diharapkan |
|---|---|
| Kamis 1 Okt 2026 06:00 | Kamis 1 Okt 07:20 |
| Kamis 1 Okt 2026 07:20 tepat | Kamis 1 Okt 17:00 (harus `>`, bukan `>=`) |
| Kamis 1 Okt 2026 12:00 | Kamis 1 Okt 17:00 |
| Jumat 2 Okt 2026 17:01 | Senin 5 Okt 07:20 |
| Sabtu 3 Okt 2026 10:00 | Senin 5 Okt 07:20 |

Kasus lain:
- `jumat-senin` (rentang melewati Minggu) → `[5,6,7,1]`.
- Jam duplikat/tidak urut `17:00,07:20,07:20` → `["07:20","17:00"]`.
- Input tidak valid: `senin-xyz`, `25:00`, `07:20,` → error yang jelas.
- Zona dengan DST (mis. `America/New_York`) tetap menghasilkan jam dinding yang benar (memakai `zonedTimeToUtc` yang sudah teruji).
- `/done <id>` menghentikan jadwal; tidak ada kiriman berikutnya.
- Scheduler dengan clock palsu: kirim 07:20, lalu `dueAt` maju ke 17:00 hari yang sama.

## 6. Di luar cakupan versi pertama (kandidat fase 2)

- **Interval dalam rentang jam**, mis. "setiap 30 menit dari 07:20 sampai 17:00". Ini bisa ditambah sebagai `schedule.every` + `schedule.until` jika memang dibutuhkan. (Bukan kebutuhan saat ini: sudah diputuskan cukup dua kiriman per hari.)
- **Libur nasional / cuti**: `/skip <id> besok` atau `/pause <id> sampai 10/10`, lalu `/resume <id>`.
- **Edit jadwal** tanpa hapus-buat ulang: `/edit <id> jam 07:30,17:00`.
- **Tanggal berakhir**: `... sampai 31/12`.
- **Pesan berbeda per jam dalam satu reminder.** Untuk sekarang cukup memakai dua reminder.

## 7. Pertanyaan terbuka

1. ~~**Interpretasi jam.**~~ ✅ **Diputuskan:** "jam 7.20 dan sore 17.00" berarti **dua kiriman per hari** (07:20 dan 17:00), bukan kiriman berulang tiap N menit di antara kedua jam itu. Mode interval tetap di fase 2.
2. **Isi pesan pagi & sore**: sama (satu reminder) atau berbeda (dua reminder)? Keduanya didukung oleh desain ini.
3. **Batas keterlambatan**: kalau bot baru nyala jauh setelah jadwal, apakah reminder tetap dikirim dengan label "terlambat" (perilaku sekarang) atau dilewati bila terlambat lebih dari, misalnya, 60 menit?
4. **Hari libur nasional**: perlu di versi pertama, atau cukup `/skip` manual nanti?
