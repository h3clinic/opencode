import { setTimeout as delay } from "node:timers/promises"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { checkCodingModel, freeModelSpace, hubReference, inspectGGUF, installedGGUF, ollama, popularGGUF, pullGGUF } from "./gguf-download"

const size = (bytes: number) => (bytes / 1024 ** 3).toFixed(2) + " GiB"

export function DialogGGUF(props: { onSelect: (provider: string, model: string) => void }) {
  const dialog = useDialog()
  const client = useClient()
  const data = useData()
  const location = useLocation().ref
  const controller = new AbortController()
  const signal = controller.signal
  onCleanup(() => controller.abort())
  const [repos, setRepos] = createSignal<string[]>([])
  const [query, setQuery] = createSignal("")
  const [status, setStatus] = createSignal("Loading popular GGUF models…")
  const [busy, setBusy] = createSignal(false)
  const [choice, setChoice] = createSignal<{ name: string; bytes: number; installed?: string }>()
  const provider = () => data.location.provider.list(location)?.find((entry) => entry.id === "ollama")
  function checkLocal() {
    const url = client.url && new URL(client.url)
    if (location?.workspaceID || (url && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))
      throw new Error("Open a local OpenCode project to download models on this computer.")
    const endpoint = provider()?.settings?.baseURL
    if (endpoint && ![ollama + "/v1", "http://localhost:11434/v1"].includes(String(endpoint).replace(/\/$/, "")))
      throw new Error("This project uses a different Ollama endpoint. Select the default local Ollama provider first.")
  }
  onMount(() => {
    dialog.setSize("large")
    popularGGUF(AbortSignal.any([signal, AbortSignal.timeout(15000)])).then((items) => {
      setRepos(items)
      if (!busy() && !choice()) setStatus("")
    }).catch(() => {
      if (!signal.aborted && !busy() && !choice()) setStatus("Could not load suggestions. Paste a Hub model ID to continue.")
    })
  })
  async function run(action: () => Promise<void>) {
    if (busy()) return
    setBusy(true)
    try {
      checkLocal()
      await action()
    } catch (error) {
      if (!signal.aborted) setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  function inspect(id: string) {
    void run(async () => {
      setStatus("Checking GGUF size and Ollama…")
      const probe = AbortSignal.any([signal, AbortSignal.timeout(20000)])
      const model = await inspectGGUF(id, probe)
      const installed = await installedGGUF(model.name, probe)
      if (!installed) {
        const available = await freeModelSpace()
        if (available < model.bytes) throw new Error(`Needs ${size(model.bytes)}. Only ${size(available)} available for Ollama.`)
      }
      if (signal.aborted) return
      setChoice({ ...model, installed })
      setStatus("")
    })
  }
  function useModel() {
    const model = choice()
    if (!model) return
    void run(async () => {
      if (!model.installed) {
        setStatus("Starting download…")
        await pullGGUF(model.name, signal, setStatus)
      }
      const name = model.installed ?? await installedGGUF(model.name, signal)
      if (!name) throw new Error("Ollama finished the pull but did not list the model.")
      setChoice({ ...model, installed: name })
      await checkCodingModel(name, signal)
      setStatus("Installed. Waiting for OpenCode to discover the local model…")
      const deadline = Date.now() + 90000
      while (!signal.aborted && Date.now() < deadline) {
        await data.location.sync(location)
        if (signal.aborted) return
        checkLocal()
        const match = data.location.model.list(location)?.find((entry) =>
          entry.providerID === "ollama" && entry.enabled && entry.capabilities.tools && entry.id.toLowerCase() === name.toLowerCase())
        if (match) {
          props.onSelect("ollama", match.id)
          return
        }
        await delay(1500, undefined, { signal })
      }
      if (!signal.aborted) throw new Error("Installed in Ollama. OpenCode has not discovered it yet. Retry Use installed model.")
    })
  }
  function options() {
    const needle = query().trim()
    if (hubReference(needle)) return [needle]
    return repos().filter((id) => id.toLowerCase().includes(needle.toLowerCase()))
  }
  return <Show when={choice()} fallback={
    <DialogSelect title="Download a local GGUF model" placeholder="Search or paste owner/model[:quantization]"
      onFilter={setQuery} skipFilter options={options().map((id) => ({ title: id, value: id, onSelect: () => inspect(id) }))}
      footer={<text wrapMode="word">{status() || "Select a model to check its download size."}</text>} />
  }>{(model) =>
    <DialogSelect title="Use local GGUF model" renderFilter={false}
      options={[
        { title: model().installed ? "Use installed model" : "Download and use", value: "use", onSelect: useModel, disabled: busy() },
        { title: busy() ? "Cancel" : "Choose another model", value: "back", onSelect: () => {
          if (busy()) dialog.clear()
          else { setChoice(undefined); setStatus(""); setQuery("") }
        } },
      ]}
      footer={<text wrapMode="word">{model().name} · {size(model().bytes)}{"\n"}{status() || "Ollama will run this model on your computer."}</text>} />
  }</Show>
}
