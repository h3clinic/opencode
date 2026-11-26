import { statfs } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const ollama = "http://127.0.0.1:11434"

export function hubReference(input: string) {
  const match = /^(?:https:\/\/(?:huggingface\.co|hf\.co)\/)?([\w-][\w.-]*\/[\w-][\w.-]*)(?::([\w-]+))?\/?$/i.exec(
    input.trim(),
  )
  if (match) return { repo: match[1], tag: match[2] ?? "latest" }
}

async function request(url: string, signal: AbortSignal, body?: object) {
  const response = await fetch(url, {
    signal,
    redirect: "error",
    ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
  if (!response.ok)
    throw new Error(`${new URL(url).hostname} returned ${response.status}: ${(await response.text()).slice(0, 180)}`)
  return response
}

export async function popularGGUF(signal: AbortSignal): Promise<string[]> {
  const response = await request(
    "https://huggingface.co/api/models?filter=gguf&pipeline_tag=text-generation&sort=downloads&limit=40",
    signal,
  )
  const models = (await response.json()) as { id: string }[]
  return models.map((model) => model.id).filter((id) => hubReference(id))
}

export async function inspectGGUF(input: string, signal: AbortSignal) {
  const ref = hubReference(input)
  if (!ref) throw new Error("Enter a Hugging Face owner/model ID or model page URL.")
  await request(ollama + "/api/version", signal).catch(() => {
    throw new Error("Start Ollama on this computer (ollama serve), then retry.")
  })
  const response = await request(`https://huggingface.co/v2/${ref.repo}/manifests/${ref.tag}`, signal)
  const manifest = (await response.json()) as { layers?: { mediaType: string; size: number }[] }
  const layers = manifest.layers ?? []
  if (
    !layers.some((layer) => layer.mediaType === "application/vnd.ollama.image.model") ||
    !layers.every((layer) => Number.isSafeInteger(layer.size) && layer.size > 0)
  )
    throw new Error("This repository or quantization has no Ollama-compatible GGUF manifest.")
  return { name: `hf.co/${ref.repo}:${ref.tag}`, bytes: layers.reduce((sum, layer) => sum + layer.size, 0) }
}

export async function freeModelSpace() {
  let path = process.env.OLLAMA_MODELS || join(homedir(), ".ollama", "models")
  while (true) {
    try {
      const fs = await statfs(path)
      return fs.bavail * fs.bsize
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error
      path = dirname(path)
    }
  }
}

export async function pullGGUF(name: string, signal: AbortSignal, progress: (status: string) => void) {
  const response = await request(ollama + "/api/pull", signal, { model: name, stream: true })
  if (!response.body) throw new Error("Ollama returned an empty download response.")
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ""
  let success = false
  function update(line: string) {
    if (!line.trim()) return
    const item = JSON.parse(line)
    if (item.error) throw new Error(String(item.error))
    success = item.status === "success"
    const percent =
      item.total > 0 && typeof item.completed === "number" ? ` ${Math.floor((100 * item.completed) / item.total)}%` : ""
    progress(String(item.status) + percent)
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const lines = (pending + chunk.value).split("\n")
      pending = lines.pop()!
      for (const line of lines) update(line)
    }
    update(pending)
  } finally {
    await reader.cancel()
  }
  if (!success) throw new Error("Ollama stopped before confirming the download. Retry to resume.")
}

export async function installedGGUF(name: string, signal: AbortSignal) {
  const { models } = (await (await request(ollama + "/api/tags", signal)).json()) as { models: { model: string }[] }
  return models.find((item) => item.model.toLowerCase() === name.toLowerCase())?.model
}

export async function checkCodingModel(name: string, signal: AbortSignal) {
  const info = (await (await request(ollama + "/api/show", signal, { model: name })).json()) as {
    capabilities?: string[]
    remote_host?: string
    remote_model?: string
    details?: { format?: string }
  }
  if (
    info.remote_host ||
    info.remote_model ||
    info.details?.format !== "gguf" ||
    !["completion", "tools"].every((cap) => info.capabilities?.includes(cap))
  )
    throw new Error(
      "Ollama does not report local GGUF chat and tool support for this model. Choose a tool-capable coding model.",
    )
}
