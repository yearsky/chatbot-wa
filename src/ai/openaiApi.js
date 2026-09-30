// Provider: OpenAI API (butuh OPENAI_API_KEY, biaya per pemakaian).

import OpenAI from 'openai'

export function createOpenAiApi({ apiKey, model, timeoutMs }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY belum diisi. Jalankan: npm run setup')
  if (!model) throw new Error('Model OpenAI belum dipilih. Jalankan: npm run setup')
  const client = new OpenAI({ apiKey, timeout: timeoutMs })
  return {
    name: 'OpenAI API',
    async complete(prompt) {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
      return res.choices?.[0]?.message?.content ?? ''
    }
  }
}

// Daftar model yang tersedia untuk API key ini (dipakai di wizard setup).
export async function listOpenAiModels(apiKey) {
  const client = new OpenAI({ apiKey, timeout: 20000 })
  const ids = []
  for await (const m of client.models.list()) ids.push(m.id)
  return ids
    .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id))
    .sort()
}
