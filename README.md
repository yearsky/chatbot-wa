# Asisten Pribadi WhatsApp 🤖

Bot WhatsApp pribadi untuk **reminder** dan **catatan**, dijalankan dari terminal (cmd / PowerShell / bash) di komputermu sendiri.

- Login WhatsApp dengan **scan QR** di terminal (seperti WhatsApp Web).
- Pilih "otak" AI lewat wizard setup:
  - **Claude Code CLI**: pakai akun langganan Claude, **tanpa API key**
  - **Codex CLI**: pakai akun ChatGPT, **tanpa API key**
  - **OpenAI API**: pakai API key (bayar per pemakaian)
  - **Tanpa AI**: hanya perintah `/...`
- Bot hanya melayani **nomor pemilik**.
- **Memory bank SQLite** di `data/assistant.db` (modul bawaan Node, tanpa instalasi tambahan): catatan & konteks penting diindeks FTS5, dan yang relevan dengan pesanmu otomatis diberikan ke AI, jadi kamu bisa tanya "nomor meja aku berapa?". Cari manual dengan `/cari <kata kunci>`. Data lama `data/db.json` dipindahkan otomatis saat start pertama.

## Kebutuhan

- [Node.js](https://nodejs.org) **versi 20 atau lebih baru**
- Salah satu dari:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, lalu jalankan `claude` sekali untuk login
  - Codex CLI: `npm install -g @openai/codex`, lalu `codex login`
  - atau API key OpenAI
- Akun WhatsApp untuk bot. Disarankan **nomor kedua** (lihat bagian Risiko).

## Instalasi

```powershell
git clone https://github.com/yearsky/chatbot-wa.git
cd chatbot-wa
npm install
npm start
```

Saat pertama kali dijalankan, wizard setup akan menanyakan:

1. Penyedia AI (Claude Code CLI / Codex CLI / OpenAI API / tanpa AI)
2. Model (mis. `sonnet`, `haiku`, `opus` untuk Claude, atau ketik manual)
3. API key (hanya untuk OpenAI API, disimpan di `.env`)
4. Nomor WhatsApp pemilik, mis. `6281234567890` (awalan `0` otomatis jadi `62`)
5. Zona waktu (default `Asia/Jakarta`)

Setelah itu QR code muncul di terminal. Di HP buka **WhatsApp → Perangkat Tertaut → Tautkan Perangkat**, lalu scan.

> Jika QR terlihat rusak di cmd, perbesar jendela terminal atau pakai Windows Terminal/PowerShell.

### Perintah terminal

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan bot (wizard muncul jika belum ada konfigurasi) |
| `npm run setup` | Mengubah provider, model, nomor pemilik, zona waktu |
| `npm run logout` | Menghapus sesi WhatsApp (scan QR ulang saat `npm start`) |
| `npm test` | Menjalankan unit test |

## Cara pakai di WhatsApp

Kirim pesan ke nomor bot dari nomor pemilik.

Jika bot login di **nomormu sendiri**, pakai chat **"Kirim pesan ke diri sendiri"** (Message yourself).

### Perintah cepat (tanpa AI, tidak memakai kuota)

```
/note beli susu               → simpan catatan
/notes                        → lihat catatan
/remind 30m angkat jemuran    → reminder 30 menit lagi
/remind besok 09:00 bayar listrik
/remind 5/10 14:00 rapat
/remind harian 07:00 minum obat
/remind mingguan besok 08:00 kerja bakti
/remind senin-jumat 07:20,17:00 absen   → Sen–Jum, dua kali sehari
/remind sabtu,minggu 08:00 siram tanaman
/reminders                    → lihat reminder aktif
/done 3                       → hentikan/selesaikan reminder #3
/del 2                        → hapus catatan/reminder #2
/help                         → daftar perintah lengkap dengan contoh
```

Hari: `senin-jumat`, `sen-jum`, `senin sampai jumat`, `senin,rabu,jumat`, `hari-kerja`, `weekend`, `setiap-hari`.
Beberapa jam dipisah koma, strip, `&`, atau `dan`, jadi `07:20-17:00` berarti dua kiriman (07:20 dan 17:00).

Format waktu: `10m`, `2h`, `1h30m`, `1d`, `07:00`, `besok 09:00`, `lusa 8.30`, `5/10 14:00`, `2026-10-05 14:00`.

### Bahasa bebas (pakai AI)

```
ingatkan aku besok jam 7 pagi olahraga
catat: password wifi kantor ada di laci
reminder apa saja minggu ini?
hapus catatan soal wifi
```

AI hanya menerjemahkan pesan menjadi aksi (JSON). Penyimpanan dan penjadwalan dikerjakan oleh kode bot, jadi balasan konfirmasi selalu berasal dari data yang benar-benar tersimpan.

Dengan Claude Code CLI, bot menjaga **satu proses Claude tetap menyala** agar balasan cepat (±2–4 detik setelah hangat, dibanding 5–15 detik bila Claude dinyalakan ulang tiap pesan). Proses diganti baru setiap `claudeMaxTurns` pesan (default 10, bisa diubah di `config.json`) supaya riwayatnya tidak menumpuk.

### Pencarian Atlassian lewat MCP (opsional)

```
/atlassian sync kas
/atlassian bug login mobile banking
```

Bot menjalankan Claude Code dengan server MCP Atlassian milikmu, lalu mengirim ringkasan hasil pencarian Jira/Confluence ke WhatsApp. Aktifkan di `npm run setup`: tunjuk file MCP config yang berisi server tersebut (mis. `D:\nds\.mcp.json`) dan nama servernya.

- **Hanya baca.** Yang diizinkan hanya tool cari/baca Jira & Confluence. Tool yang mengubah data (create/update/delete/transition/comment, dsb.) dan semua tool bawaan Claude Code (baca file, Bash, dsb.) diblokir. Daftarnya bisa dilihat/diubah di `config.json` → `mcpCommands.atlassian`.
- **Bot tidak membaca isi file MCP config**; path-nya langsung diteruskan ke `claude --mcp-config`.
- Butuh Claude Code CLI terpasang, apa pun provider AI utamanya. Satu pencarian biasanya 15–30 detik.

## Supaya jalan 24/7 di komputer sendiri

- Reminder hanya terkirim saat bot menyala. Jika komputer mati, reminder yang terlewat dikirim saat bot dinyalakan lagi (ditandai "terlambat").
- Matikan mode sleep: **Settings → System → Power → Screen and sleep → Never** (Windows).
- Agar otomatis jalan saat login Windows, buat file `start-bot.bat`:
  ```bat
  @echo off
  cd /d C:\path\ke\chatbot-wa
  npm start
  ```
  lalu taruh shortcut-nya di folder Startup (`Win + R` → `shell:startup`).
- Bot otomatis menyambung ulang jika koneksi internet putus.

## Struktur proyek

```
src/index.js       entry point & terminal
src/setup.js       wizard setup
src/wa.js          koneksi WhatsApp (Baileys), QR, filter pemilik
src/assistant.js   router perintah / AI
src/commands.js    parser perintah /...
src/scheduler.js   pengirim reminder
src/db.js          memory bank SQLite (FTS5) untuk catatan & reminder
src/time.js        parsing & format waktu
src/ai/            provider: claudeCli (+ claudeSession: proses persisten), codexCli, openaiApi
src/ai/mcpQuery.js perintah MCP (/atlassian)
```

File lokal yang **tidak** di-commit: `config.json`, `.env`, `auth/` (sesi WhatsApp), `data/`.

## Risiko & catatan penting

- **Library tidak resmi.** Bot memakai [Baileys](https://github.com/WhiskeySockets/Baileys), klien WhatsApp Web tidak resmi. WhatsApp bisa membatasi atau memblokir nomor yang memakai klien tidak resmi. Pakai nomor kedua jika memungkinkan.
- **Ketentuan layanan AI.** Memakai Claude Code / Codex CLI dengan akun langganan untuk otomasi seperti ini bisa terkena batas pemakaian atau aturan penggunaan yang berubah dari waktu ke waktu. Cek sendiri ketentuan terbaru dari Anthropic dan OpenAI. Setiap pesan non-perintah memakai kuota langganan. Pakai perintah `/...` untuk menghemat kuota.
- **Rahasia.** Folder `auth/` berisi sesi WhatsApp dan `.env` berisi API key. Jangan dibagikan atau di-commit.
- **Data kantor ke WhatsApp.** `/atlassian` mengirim isi Jira/Confluence ke chat WhatsApp (dan ke HP/perangkat tertaut). Pastikan ini sesuai kebijakan keamanan data di tempat kerjamu sebelum mengaktifkannya.
