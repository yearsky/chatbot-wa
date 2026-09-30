# Asisten Pribadi WhatsApp 🤖

Bot WhatsApp pribadi untuk **reminder** dan **catatan**, dijalankan dari terminal (cmd / PowerShell / bash) di komputermu sendiri.

- Login WhatsApp dengan **scan QR** di terminal (seperti WhatsApp Web).
- Pilih "otak" AI lewat wizard setup:
  - **Claude Code CLI**: pakai akun langganan Claude, **tanpa API key**
  - **Codex CLI**: pakai akun ChatGPT, **tanpa API key**
  - **OpenAI API**: pakai API key (bayar per pemakaian)
  - **Tanpa AI**: hanya perintah `/...`
- Bot hanya melayani **nomor pemilik**.
- Data disimpan lokal di `data/db.json`.

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
/reminders                    → lihat reminder aktif
/done 3                       → hentikan/selesaikan reminder #3
/del 2                        → hapus catatan/reminder #2
/help
```

Format waktu: `10m`, `2h`, `1h30m`, `1d`, `07:00`, `besok 09:00`, `lusa 8.30`, `5/10 14:00`, `2026-10-05 14:00`.

### Bahasa bebas (pakai AI)

```
ingatkan aku besok jam 7 pagi olahraga
catat: password wifi kantor ada di laci
reminder apa saja minggu ini?
hapus catatan soal wifi
```

AI hanya menerjemahkan pesan menjadi aksi (JSON). Penyimpanan dan penjadwalan dikerjakan oleh kode bot, jadi balasan konfirmasi selalu berasal dari data yang benar-benar tersimpan.

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
src/db.js          penyimpanan JSON
src/time.js        parsing & format waktu
src/ai/            provider: claudeCli, codexCli, openaiApi
```

File lokal yang **tidak** di-commit: `config.json`, `.env`, `auth/` (sesi WhatsApp), `data/`.

## Risiko & catatan penting

- **Library tidak resmi.** Bot memakai [Baileys](https://github.com/WhiskeySockets/Baileys), klien WhatsApp Web tidak resmi. WhatsApp bisa membatasi atau memblokir nomor yang memakai klien tidak resmi. Pakai nomor kedua jika memungkinkan.
- **Ketentuan layanan AI.** Memakai Claude Code / Codex CLI dengan akun langganan untuk otomasi seperti ini bisa terkena batas pemakaian atau aturan penggunaan yang berubah dari waktu ke waktu. Cek sendiri ketentuan terbaru dari Anthropic dan OpenAI. Setiap pesan non-perintah memakai kuota langganan. Pakai perintah `/...` untuk menghemat kuota.
- **Rahasia.** Folder `auth/` berisi sesi WhatsApp dan `.env` berisi API key. Jangan dibagikan atau di-commit.
