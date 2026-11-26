import { setTimeout as delay } from "node:timers/promises"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import {
  checkCodingModel,
  freeModelSpace,
  hubReference,
  inspectGGUF,
  installedGGUF,
  localTarget,
  ollamaRoot,
  type OllamaTarget,
  popularGGUF,
  pullGGUF,
} from "./gguf-download"

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
  const [target, setTarget] = createSignal<OllamaTarget>()
  const [targetError, setTargetError] = createSignal("")
  function configured(id: string): OllamaTarget | undefined {
    const provider = data.location.provider.list(location)?.find((entry) => entry.id === id)
    let baseURL: unknown
    let apiKey: unknown
    for (const entry of data.location.config.list(location) ?? []) {
      if (entry.type !== "document") continue
      const settings = entry.info.providers?.[id]?.settings
      if (settings?.baseURL !== undefined && settings.baseURL !== baseURL) apiKey = undefined
      baseURL = settings?.baseURL ?? baseURL
      if (settings?.apiKey !== undefined) apiKey = settings.apiKey
    }
    baseURL ??= provider?.settings?.baseURL
    if (!baseURL && id === "ollama") baseURL = localTarget.root
    if (typeof baseURL !== "string") return
    const root = ollamaRoot(baseURL)
    return { providerID: id, root, apiKey: typeof apiKey === "string" ? apiKey : undefined }
  }
  function isLocal(t: OllamaTarget) {
    return t.providerID === "ollama" && [localTarget.root, "http://localhost:11434"].includes(t.root)
  }
  function choose(remote: boolean) {
    try {
      const primary = configured("ollama")
      const next = remote
        ? (configured("ollama-remote") ?? (primary && !isLocal(primary) ? primary : undefined))
        : primary
      if (!next)
        throw new Error(
          "Set providers.ollama-remote.settings.baseURL in opencode.jsonc to your GPU server's Ollama /v1 URL, then reopen the picker.",
        )
      if (!remote && !isLocal(next))
        throw new Error("Move your remote endpoint to providers.ollama-remote to use both machines.")
      if (!remote) {
        const url = client.url && new URL(client.url)
        if (location?.workspaceID || (url && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))
          throw new Error("Open a local OpenCode project to use this computer.")
      }
      setTargetError("")
      setTarget(next)
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : String(error))
    }
  }
  function checkTarget(t: OllamaTarget, modelURL?: unknown) {
    const active = data.location.provider.list(location)?.find((entry) => entry.id === t.providerID)?.settings?.baseURL
    if (
      (typeof active === "string" && ollamaRoot(active) !== t.root) ||
      configured(t.providerID)?.root !== t.root ||
      (typeof modelURL === "string" && ollamaRoot(modelURL) !== t.root)
    )
      throw new Error("The Ollama endpoint changed. Reopen the picker to choose a target.")
  }
  onMount(() => {
    dialog.setSize("large")
    popularGGUF(AbortSignal.any([signal, AbortSignal.timeout(15000)]))
      .then((items) => {
        setRepos(items)
        if (!busy() && !choice()) setStatus("")
      })
      .catch(() => {
        if (!signal.aborted && !busy() && !choice())
          setStatus("Could not load suggestions. Paste a Hub model ID to continue.")
      })
  })
  async function run(action: (t: OllamaTarget) => Promise<void>) {
    const t = target()
    if (busy() || !t) return
    setBusy(true)
    try {
      checkTarget(t)
      await action(t)
    } catch (error) {
      if (!signal.aborted) setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  function inspect(id: string) {
    void run(async (t) => {
      setStatus("Checking GGUF size and Ollama…")
      const probe = AbortSignal.any([signal, AbortSignal.timeout(20000)])
      const model = await inspectGGUF(id, probe, t)
      const installed = await installedGGUF(model.name, probe, t)
      if (!installed && isLocal(t)) {
        const available = await freeModelSpace()
        if (available < model.bytes)
          throw new Error(`Needs ${size(model.bytes)}. Only ${size(available)} available for Ollama.`)
      }
      if (signal.aborted) return
      setChoice({ ...model, installed })
      setStatus("")
    })
  }
  function useModel() {
    const model = choice()
    if (!model) return
    void run(async (t) => {
      if (!model.installed) {
        setStatus("Starting download…")
        await pullGGUF(model.name, signal, setStatus, t)
      }
      const name = model.installed ?? (await installedGGUF(model.name, signal, t))
      if (!name) throw new Error("Ollama finished the pull but did not list the model.")
      setChoice({ ...model, installed: name })
      await checkCodingModel(name, signal, t)
      setStatus("Installed. Waiting for OpenCode to discover the local model…")
      const deadline = Date.now() + 90000
      while (!signal.aborted && Date.now() < deadline) {
        data.location.model.invalidate(location)
        data.location.provider.invalidate(location)
        await Promise.all([data.location.model.sync(location), data.location.provider.sync(location)])
        if (signal.aborted) return
        checkTarget(t)
        const match = data.location.model
          .list(location)
          ?.find(
            (entry) =>
              entry.providerID === t.providerID &&
              entry.enabled &&
              entry.capabilities.tools &&
              entry.id.toLowerCase() === name.toLowerCase(),
          )
        if (match) {
          checkTarget(t, match.settings?.baseURL)
          props.onSelect(t.providerID, match.id)
          return
        }
        await delay(1500, undefined, { signal })
      }
      if (!signal.aborted)
        throw new Error("Installed in Ollama. OpenCode has not discovered it yet. Retry Use installed model.")
    })
  }
  function options() {
    const needle = query().trim()
    if (hubReference(needle)) return [needle]
    return repos().filter((id) => id.toLowerCase().includes(needle.toLowerCase()))
  }
  return (
    <Show
      when={target()}
      fallback={
        <DialogSelect
          title="Where should the model run?"
          renderFilter={false}
          options={[
            { title: "Local computer", value: "local", onSelect: () => choose(false) },
            { title: "Remote GPU", value: "remote", onSelect: () => choose(true) },
          ]}
          footer={
            <text wrapMode="word">
              {targetError() || "The selected Ollama server stores the weights and runs inference."}
            </text>
          }
        />
      }
    >
      <Show
        when={choice()}
        fallback={
          <DialogSelect
            title="Download a GGUF model"
            placeholder="Search or paste owner/model[:quantization]"
            onFilter={setQuery}
            skipFilter
            options={options().map((id) => ({ title: id, value: id, onSelect: () => inspect(id) }))}
            footer={<text wrapMode="word">{status() || "Select a model to check its download size."}</text>}
          />
        }
      >
        {(model) => (
          <DialogSelect
            title="Use GGUF model"
            renderFilter={false}
            options={[
              {
                title: model().installed ? "Use installed model" : "Download and use",
                value: "use",
                onSelect: useModel,
              },
              {
                title: busy() ? "Cancel" : "Choose another model",
                value: "back",
                onSelect: () => {
                  if (busy()) dialog.clear()
                  else {
                    setChoice(undefined)
                    setStatus("")
                    setQuery("")
                  }
                },
              },
            ]}
            footer={
              <text wrapMode="word">
                {model().name} · {size(model().bytes)} · {target()?.root}
                {"\n"}
                {status() || "Ollama will download and run this model on the selected machine."}
              </text>
            }
          />
        )}
      </Show>
    </Show>
  )
}
