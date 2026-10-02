# SDD — Asisten Pribadi WhatsApp

| | |
|---|---|
| Versi dokumen | 1.0 (30 September 2026) |
| Lokasi kode | `D:\belajar\chatbot-wa` (folder hasil ekstrak ZIP, **bukan** repo git) |
| Status GitHub | Branch `claude/whatsapp-personal-assistant-1jpbqg` hanya berisi versi awal; semua perubahan sesudahnya ada di folder lokal saja |
| Runtime | Node.js ≥ 22.5 (dipakai: v22.23.2, Windows 11) |
| Test | 39 test `node --test`, semua lulus di Windows |

---

## 1. Tujuan

Asisten pribadi di WhatsApp untuk satu orang (pemilik), dijalankan dari terminal (cmd/PowerShell) di PC sendiri, 24/7:

1. **Reminder**: sekali atau berulang (harian/mingguan), dengan bahasa bebas atau perintah `/`.
2. **Memory bank**: menyimpan catatan dan konteks penting, lalu menjawab pertanyaan dari catatan itu.
3. **Pencarian kerja (opsional)**: membaca Jira, Confluence, dan Bitbucket lewat MCP Atlassian, hanya baca.
4. **Tanpa API key berbayar**: "otak" AI memakai Claude Code CLI dengan akun langganan (OpenAI API/Codex tetap tersedia sebagai pilihan).

### Di luar lingkup (saat ini)

- Banyak pengguna, grup WhatsApp, pesan suara/gambar/stiker.
- Riwayat percakapan antar-pesan (setiap pesan diproses berdiri sendiri; lihat §12.1).
- Pencarian semantik berbasis embedding.
- Menulis/mengubah data di Atlassian.

---

## 2. Keputusan desain utama

| # | Keputusan | Alasan |
|---|---|---|
| D1 | WhatsApp lewat **Baileys** (`baileys@7.0.0-rc14`), login scan QR | Satu-satunya cara tanpa WhatsApp Business API. Risiko: klien tidak resmi (§11). |
| D2 | Identitas browser **`Chrome`** (bukan `Desktop`) | Server WhatsApp menolak `Desktop`/`Mac OS Desktop` saat pairing QR (kode 428); `Chrome` diterima. Diuji dari PC pemilik. |
| D3 | **AI hanya menerjemahkan** pesan ke JSON aksi; kode yang mengeksekusi | Balasan konfirmasi selalu dari data yang benar-benar tersimpan, bukan klaim AI. Aksi bisa divalidasi (tanggal, ID, sumber). |
| D4 | Perintah `/` diproses **tanpa AI** | Instan, tidak memakai kuota, tetap jalan saat AI error. |
| D5 | Claude dijalankan dengan **`--system-prompt` sendiri** dan **`--tools ""`** | System prompt bawaan Claude Code ("asisten software engineering") membuat Haiku menolak tugas non-coding. Tool dimatikan karena AI tidak perlu mengakses file. |
| D6 | **Satu proses Claude terus menyala** (stream-json), diganti tiap 10 pesan | Waktu nyala Claude Code 5–15 detik per panggilan; setelah hangat balasan 2–4 detik. Diganti berkala agar riwayat tidak menumpuk. |
| D7 | `--bare` **tidak dipakai** | Lebih cepat, tapi login akun langganan tidak terbaca ("Not logged in"). |
| D8 | Penyimpanan **SQLite bawaan Node** (`node:sqlite`) + **FTS5** | Tanpa native module (instalasi mulus di Windows). FTS5 meniru pendekatan `nds-knowledge-index` untuk pencarian kata kunci. |
| D9 | **Tanpa embedding** | Butuh model yang diunduh dari internet (firewall kantor). Pencocokan makna diserahkan ke Claude dari kandidat hasil FTS5. |
| D10 | MCP dijalankan lewat **`claude -p --mcp-config <file> --strict-mcp-config`** | Server Atlassian terdaftar di scope project `D:\nds\.mcp.json`, jadi tidak otomatis termuat dari folder bot. Bot **tidak membaca** isi file itu; path-nya diteruskan ke Claude. |
| D11 | MCP **hanya baca**: allowlist tool baca + denylist tool tulis + semua tool bawaan dimatikan | Data kantor dari WhatsApp; model tidak boleh mengubah data atau membaca file lokal (mis. `config.yaml` berisi kredensial). |

---

## 3. Arsitektur

```
 HP pemilik ──WhatsApp──▶ Baileys (src/wa.js)
                            │  filter: hanya nomor pemilik, bukan grup/status
                            ▼
                  src/index.js  onMessage(text)
                            │
                            ▼
                  src/assistant.js  handle(text, {notify})
          ┌─────────────────┼───────────────────────────┐
          ▼                 ▼                           ▼
   /atlassian ...    /note /remind /cari ...     bahasa bebas
   (matchMcp)        (src/commands.js)           buildPrompt → AI → JSON
          │                 │                           │ validateIntent
          │                 ▼                           ▼
          │          execute(intent) ◀──────── aksi catatan/reminder
          │                 │                           │ search_mcp
          ▼                 ▼                           ▼
  src/ai/mcpQuery.js   src/db.js (SQLite)      runMcp → mcpQuery.js
  claude -p + MCP      entries + entries_fts
          │
          ▼
  atlassian-mc-server.exe (stdio, config-stdio.yaml)
          │
          ▼
  Jira / Confluence / Bitbucket BRI

 src/scheduler.js (tiap 30 detik) ── dueReminders ──▶ wa.sendToOwner()
```

### 3.1 Modul

| File | Tanggung jawab |
|---|---|
| `src/index.js` | Entry point: `npm start` / `--setup` / `--logout`; merangkai store, AI, MCP, WhatsApp, scheduler; shutdown rapi. |
| `src/setup.js` | Wizard terminal (`@inquirer/prompts`): provider, model, nomor & nama pemilik, zona waktu, `/atlassian`; tes koneksi AI. |
| `src/config.js` | Path file (`config.json`, `.env`, `auth/`, `data/`), default config, normalisasi nomor. |
| `src/wa.js` | Koneksi Baileys, QR, reconnect + watchdog 60 detik, filter pemilik (termasuk LID & chat ke diri sendiri), kirim teks. |
| `src/assistant.js` | Router pesan; format konfirmasi reminder; eksekusi aksi; perintah MCP & pesan sela. |
| `src/commands.js` | Parser perintah `/` dan teks bantuan. |
| `src/scheduler.js` | Loop reminder; format pesan pengingat; retry saat WhatsApp putus. |
| `src/db.js` | Memory bank SQLite: catatan, reminder, FTS5, konteks relevan, migrasi dari `db.json`. |
| `src/time.js` | Zona waktu via `Intl`, parser waktu (`10m`, `besok 09:00`, `5/10 14:00`, …), format "2 menit", "besok pukul 07.00". |
| `src/ai/prompt.js` | Prompt intent, ekstraksi & validasi JSON, resolusi sumber MCP (alias jira/confluence/bitbucket). |
| `src/ai/claudeSession.js` | Proses Claude persisten (stream-json): pemanasan, antrean, rotasi, pemulihan crash, timeout. |
| `src/ai/claudeCli.js` | Provider Claude: sesi persisten + fallback sekali jalan. |
| `src/ai/mcpQuery.js` | Perintah MCP: argumen read-only, cek status server dari event `init`, prompt pencarian. |
| `src/ai/cli.js` | Spawn lintas platform (quoting cmd.exe), `killTree` (taskkill /T di Windows). |
| `src/ai/codexCli.js`, `openaiApi.js` | Provider alternatif (belum diuji dengan akun sungguhan). |

---

## 4. Alur utama

### 4.1 Pesan masuk
1. `messages.upsert` (type `notify`) → abaikan grup, status, pesan kiriman bot sendiri.
2. Pengirim harus nomor pemilik. Baileys v7 bisa memberi JID format LID, jadi dicek juga `remoteJidAlt`/`participantAlt` dan mapping LID→PN. Bila bot login di nomor pemilik sendiri, hanya chat "kirim pesan ke diri sendiri" yang dilayani.
3. Teks diambil dari teks biasa, extended text, atau caption.
4. Indikator "mengetik…" nyala → `assistant.handle()` → balasan mengutip pesan asli.

### 4.2 Bahasa bebas (AI)
1. `buildPrompt` memuat: waktu sekarang (ISO + zona), nama pemilik, **catatan relevan** (hasil FTS5 ≤10 + 10 terbaru), reminder aktif, sumber MCP aktif.
2. AI mengembalikan satu JSON: `action` ∈ `add_note | list_notes | search_notes | add_reminder | list_reminders | delete | done | search_mcp | chat`, plus `text`, `due_at`, `repeat`, `id`, `source`, `query`, `reply`.
3. `validateIntent`: aksi dikenal, `due_at` valid & di masa depan, ID ada, sumber MCP aktif (alias `confluence`/`jira`/`bitbucket` → `atlassian`; jika hanya satu sumber aktif, pakai itu).
4. `execute` menulis ke DB dan membentuk balasan dari data yang tersimpan.

### 4.3 Reminder
- Konfirmasi: `Oke aku ingetin kamu 2 menit lagi ya pukul 15.17 untuk minum air` (durasi ditampilkan bila < 6 jam; selebihnya `besok pukul 07.00` / `Kam, 8 Okt pukul 09.00`; reminder berulang ditambah info `/done <id>`).
- Saat jatuh tempo: `Hii Kai, aku mau remind minum air jangan lupa ya`.
- Terlambat > 5 menit (PC sempat mati): ditambah `(harusnya pukul X, maaf telat karena bot sempat mati)`.
- Gagal kirim (WhatsApp putus) → reminder tetap `pending`, dicoba lagi tick berikutnya.
- Berulang: `nextOccurrence` melompati jadwal yang terlewat, jam dinding tetap walau DST.

### 4.4 Pencarian MCP (`/atlassian` atau bahasa bebas)
1. Kirim pesan sela `🔎 Lagi nyari "…" di Atlassian…`.
2. Spawn `claude -p --output-format stream-json --verbose --mcp-config D:\nds\.mcp.json --strict-mcp-config --allowedTools <baca> --disallowedTools <tulis + bawaan> --tools ""`.
3. Baca event `system/init`: bila status server ≠ `connected` → hentikan proses (hemat kuota) dan kirim error yang bisa ditindaklanjuti.
4. Ambil event `result`, potong ≤ 3.500 karakter, kirim ke WhatsApp.

### 4.5 Sesi Claude persisten
- Start bot → `warm()` menyalakan proses dan mengirim pesan pemanasan (Claude baru siap setelah pesan pertama).
- Pesan diantrikan satu per satu per proses.
- Setelah `claudeMaxTurns` (default 10, termasuk pemanasan) → stdin ditutup, proses pengganti disiapkan di latar.
- Crash/timeout → proses dibuang; pesan berikutnya membuat proses baru. Bila sesi gagal → fallback `claude -p` sekali jalan.

---

## 5. Data

### 5.1 SQLite `data/assistant.db`

```sql
entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- ID bersama catatan & reminder (/del <id> tidak ambigu)
  kind TEXT CHECK (kind IN ('note','reminder')),
  text TEXT NOT NULL,
  due_at TEXT,                            -- ISO UTC, hanya reminder
  repeat TEXT DEFAULT 'none',             -- none | daily | weekly
  status TEXT DEFAULT 'pending',          -- pending | done
  created_at TEXT NOT NULL,
  fired_at TEXT
)
entries_fts USING fts5(text, content='entries', tokenize='unicode61 remove_diacritics 2')
-- disinkronkan dengan trigger insert/update/delete
```

- Query FTS: token ≥ 3 huruf (atau angka), buang stopword Indonesia/Inggris, pencarian prefiks, digabung `OR`, urut `bm25`.
- Migrasi: `data/db.json` lama diimpor sekali dengan ID yang sama, lalu diganti nama `db.json.migrated`.
- WAL mode; peringatan eksperimental `node:sqlite` disembunyikan.

### 5.2 `config.json` (tanpa rahasia)

```jsonc
{
  "provider": "claude-cli",          // claude-cli | codex-cli | openai-api | none
  "model": "haiku",                  // alias Claude atau nama model
  "ownerNumber": "62…",
  "ownerName": "Kai",
  "timezone": "Asia/Jakarta",
  "aiTimeoutMs": 120000,
  "claudeMaxTurns": 10,
  "mcpCommands": {
    "atlassian": {
      "server": "atlassian",
      "label": "Atlassian (Jira, Confluence & Bitbucket)",
      "mcpConfig": "D:\\nds\\.mcp.json",   // atau data/mcp-atlassian.json untuk mode HTTP (berisi URL saja)
      "allowedTools": ["jira_search_jql", "…", "bitbucket_get_file_content"],
      "deniedTools": ["jira_create_issue", "…", "bitbucket_merge_pull_request"]
    }
  }
}
```

### 5.3 File lokal lain (tidak untuk dibagikan)

| Path | Isi |
|---|---|
| `auth/` | Sesi WhatsApp (Baileys multi-file auth) |
| `.env` | `OPENAI_API_KEY` bila provider OpenAI API |
| `data/assistant.db*` | Memory bank |

---

## 6. Perintah

| Perintah | Fungsi |
|---|---|
| `/note <teks>`, `/notes`, `/cari <kata>` | Simpan, lihat, cari catatan |
| `/remind <waktu> <teks>` | Reminder; `harian`/`mingguan` untuk berulang |
| `/reminders`, `/done <id>`, `/del <id>` | Lihat, selesaikan, hapus |
| `/atlassian <kata kunci / pertanyaan / link>` | Cari di Jira/Confluence/Bitbucket (bila aktif) |
| `/help` | Bantuan (daftar MCP dinamis) |
| Terminal: `npm start`, `npm run setup`, `npm run logout`, `npm test` | |

---

## 7. Keamanan & privasi

- **Hanya pemilik** yang dilayani; grup & nomor lain diabaikan.
- **MCP hanya baca**, berlapis:
  1. `--allowedTools`: hanya tool `get/search/list` Jira, Confluence, Bitbucket.
  2. `--disallowedTools`: tool tulis (create/update/delete/transition/comment, create branch/PR, merge, trigger build/deploy) + tool bawaan Claude (Bash, Read, Write, Edit, Glob, Grep, WebFetch, …).
  3. `--tools ""`: tool bawaan dimatikan. Diuji dengan server MCP palsu: tool MCP yang diizinkan tetap jalan, tool yang diblokir tidak terlihat oleh model.
- **Kredensial Atlassian tidak pernah dibaca bot.** Server memakai `config-stdio.yaml` miliknya sendiri. Prompt melarang model mengisi parameter `auth` (tool atlassian-mcp punya parameter auth opsional yang menggantikan kredensial config).
- **Data kantor ke WhatsApp**: hasil Jira/Confluence/Bitbucket (termasuk potongan kode lewat `bitbucket_get_file_content`) terkirim ke chat & perangkat tertaut. Pemilik bertanggung jawab memastikan sesuai kebijakan kantor; tool bisa dihapus dari `allowedTools`.
- Repo lama sempat meng-commit OpenAI API key (`key.json`) dan sesi WhatsApp (`yusril.json`); keduanya dihapus dari kode, tetapi masih ada di riwayat git. Key harus di-revoke.

---

## 8. Operasional

- Jalankan: `cd D:\belajar\chatbot-wa` → `npm start` (wizard otomatis bila belum ada config).
- Log terminal: pesan masuk `←`, balasan `→`, status koneksi, `MCP atlassian: connected|failed`, jumlah isi memory bank saat start.
- 24/7: matikan sleep Windows; opsional `start-bot.bat` di folder Startup.
- Jaringan kantor: `github.com` diblokir, `codeload.github.com`, `registry.npmjs.org`, `web.whatsapp.com` bisa diakses.
- Jangan menjalankan dua instance bot dengan folder `auth/` yang sama.

---

## 9. Pengujian

**Otomatis (39 test, Windows):** parser & zona waktu (termasuk DST), perintah, store SQLite (FTS5, relevansi, migrasi, persistensi), prompt & validasi (alias sumber), format pesan, scheduler (retry & terlambat), sesi Claude persisten (reuse, rotasi, crash, antrean) dengan CLI palsu lewat wrapper `.cmd` (menguji quoting cmd.exe), provider sekali jalan, runner MCP (argumen read-only, server gagal/tidak ada), wizard (resolusi path/URL MCP).

**Manual dengan Claude sungguhan (haiku):** alur reminder/catatan/daftar/hapus; format konfirmasi & pengingat; memory ("nomor meja aku berapa?" menemukan catatan yang sudah tergeser); routing "coba pahami <link>" ke Atlassian; pesan error server MCP mati; waktu balasan sesi persisten.

**Diverifikasi pemilik di lapangan:** scan QR, kirim/terima WhatsApp, reminder terkirim, `/atlassian` ke Confluence BRI (setelah memperbarui kredensial di `config-stdio.yaml`).

**Belum diuji:** Codex CLI & OpenAI API dengan akun sungguhan, mode MCP HTTP, Bitbucket ke server asli, reconnect WhatsApp jangka panjang.

---

## 10. Kinerja (terukur)

| Skenario | Waktu |
|---|---|
| Claude dinyalakan ulang per pesan | 5–15 detik |
| Sesi persisten setelah hangat | 2,4–3,7 detik |
| Waktu API model saja (haiku) | ±2,5 detik |
| Pencarian MCP Atlassian | 15–30 detik |
| Perintah `/` | instan |

---

## 11. Risiko & batasan

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Baileys klien tidak resmi; v7 masih RC | Nomor dibatasi/diblokir; perubahan protokol | Pakai nomor kedua; bisa turun ke `baileys@6.7.x` |
| Ketentuan langganan Claude untuk otomasi | Kuota/aturan berubah | Perintah `/` tanpa AI; pemilik memantau kebijakan Anthropic |
| Tanpa riwayat percakapan | Tanya-jawab lanjutan ("iya", "yang tadi") tidak nyambung | Fitur checkpoint (§12.1) |
| FTS tanpa embedding | Catatan yang tidak berbagi kata dengan pertanyaan bisa terlewat | Catatan terbaru selalu ikut; pertimbangkan embedding lokal nanti |
| Pesan pertama setelah start lambat | ~18 detik bila pemanasan belum selesai | Pemanasan dimulai saat start |
| Kode tidak di git | Sulit melacak/rollback perubahan | Inisialisasi git lokal atau sinkron ke GitHub bila jaringan memungkinkan |

---

## 12. Rencana fitur berikutnya

### 12.1 Auto switch model dengan checkpoint konteks

**Tujuan:** bot berpindah model secara otomatis (atau manual) tanpa kehilangan konteks pembahasan terakhir.

**Masalah saat ini:**
- Tidak ada riwayat percakapan tersimpan; tiap pesan berdiri sendiri. Proses Claude persisten memang menyimpan riwayat, tapi hilang saat rotasi tiap 10 pesan, dan system prompt menyuruh model mengabaikannya.
- Model tetap satu (`config.model`); bila kuota/limit habis atau Claude error, bot hanya fallback ke mode sekali jalan dengan model yang sama.

**Usulan desain:**

1. **Log percakapan** (tabel baru):
   ```sql
   turns (id, role TEXT /* user|assistant */, text, action TEXT, model TEXT, created_at)
   checkpoints (id, summary TEXT, upto_turn_id INTEGER, model TEXT, created_at)
   ```
2. **Checkpoint**: ringkasan pembahasan (topik, keputusan, pertanyaan terbuka, entitas penting seperti ID catatan/issue) dibuat:
   - setiap N giliran (mis. 10, selaras rotasi sesi),
   - sebelum rotasi proses Claude,
   - sebelum berpindah model.
3. **Prompt** menyertakan: checkpoint terakhir + K giliran terakhir sesudahnya (mis. 6), menggantikan instruksi "abaikan pesan sebelumnya".
4. **Rantai model** di `config.json`, contoh:
   ```jsonc
   "modelChain": [
     { "provider": "claude-cli", "model": "haiku" },
     { "provider": "claude-cli", "model": "sonnet" },
     { "provider": "codex-cli" }
   ]
   ```
5. **Pemicu pindah**:
   - error limit/kuota atau `is_error` dari Claude, timeout berulang → turun ke model berikutnya;
   - eskalasi kompleksitas (mis. pencarian MCP atau permintaan analisis panjang) → naik ke model lebih kuat;
   - manual: `/model sonnet`, `/model auto`.
   - kembali ke model utama setelah jeda (mis. 30 menit) atau saat pemilik minta.
6. **Transparansi**: kirim pesan singkat `🔁 Pindah ke sonnet (haiku kena limit), konteks terakhir tetap aku ingat.` dan log di terminal.

**Pertanyaan terbuka untuk besok:**
- Pemicu mana yang wajib: limit/error saja, atau juga eskalasi kompleksitas?
- Rantai model yang diinginkan (hanya Claude, atau lintas Codex/OpenAI)?
- Model mana yang membuat ringkasan checkpoint (hemat kuota vs kualitas)?
- Berapa lama riwayat disimpan, dan perlukah `/lupa` untuk menghapus konteks?
- Deteksi "limit" dari output Claude CLI: pesan/`subtype` apa yang muncul saat kuota habis (perlu dicek dari contoh nyata).

### 12.2 Integrasi RTK untuk Claude

**Status:** pemilik menyatakan RTK sudah siap di PC lokal, tetapi `rtk` **tidak ditemukan** di PATH sesi pengembangan ini maupun di lokasi instalasi umum (`.cargo\bin`, `.local\bin`, WinGet, scoop, npm global), dan tidak ada referensi `rtk` di `~/.claude/settings.json`. Perlu diverifikasi besok: lokasi biner, versi, dan cara pemasangannya.

**Asumsi yang perlu dikonfirmasi:** RTK yang dimaksud adalah proxy CLI yang memadatkan output perintah (mis. `git`, `ls`, output test) sebelum masuk ke konteks LLM, biasanya dipasang ke Claude Code lewat hook, untuk menghemat token.

**Catatan desain penting:** Claude di bot ini berjalan dengan **semua tool bawaan dimatikan** (`--tools ""`), jadi tidak ada perintah shell yang outputnya bisa dipadatkan RTK. Tempat yang mungkin mendapat manfaat:
- Pencarian MCP, bila RTK bisa memadatkan hasil tool MCP (Confluence/Bitbucket bisa besar), dan
- sesi Claude Code interaktif pemilik di luar bot.

**Pertanyaan terbuka untuk besok:**
- RTK mana (nama repo/versi) dan bagaimana integrasinya: hook Claude Code, wrapper perintah, atau proxy API?
- Apakah RTK memadatkan output tool MCP, atau hanya perintah shell?
- Target yang diukur: pengurangan token per pencarian MCP / per pesan, dan dampaknya ke kualitas jawaban.
- Bila lewat hook di `settings.json`: sesi `claude -p` bot memuat setting user (tidak memakai `--bare`), jadi hook akan ikut aktif. Perlu dipastikan hook tidak menambah waktu start dan tidak mengaktifkan tool yang sengaja dimatikan.

---

## 13. Riwayat keputusan (30 September 2026)

1. Refactor total dari bot lama (Baileys 4 + OpenAI + Google Sheet) ke proyek ESM baru; secret yang ter-commit dihapus.
2. Wizard setup multi-provider (Claude CLI / Codex CLI / OpenAI API / tanpa AI).
3. Kode diunduh via `codeload.github.com` (github.com diblokir) ke `D:\belajar\chatbot-wa`.
4. Perbaikan pairing QR (identitas `Chrome`) dan bug `cwd` saat tes Claude.
5. System prompt Claude diganti agar Haiku tidak menolak tugas non-coding.
6. Format pesan reminder sesuai permintaan pemilik; nama panggilan.
7. Sesi Claude persisten (5–15 detik → 2–4 detik).
8. `/atlassian` via MCP read-only; pengaman diuji dengan server MCP palsu.
9. Memory bank SQLite + FTS5; routing Atlassian dari bahasa bebas; alias sumber.
10. Deteksi status server MCP dari event `init`; wizard menolak folder, menerima file/URL.
11. Penyebab auth gagal: `config-stdio.yaml` (dipakai MCP) berbeda dari `config.yaml`; pemilik memperbarui kredensial di `config-stdio.yaml`. Larangan mengisi parameter `auth` ditambahkan ke prompt.
12. Bitbucket read-only ditambahkan ke preset `/atlassian`.
