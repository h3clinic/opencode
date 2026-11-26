import type { ModelInfo } from "@opencode/client"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogIntegration } from "./dialog-integration"
import { Link } from "../ui/link"
import { useToast } from "../ui/toast"
import { huggingFaceModelID } from "./huggingface-model-id"
import { DialogGGUF } from "./dialog-gguf"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"
import { modelPreferenceKey } from "../model-preference"
import { useLocation } from "../context/location"
import { useNewDesigns } from "../config"
import { DialogFreeModels } from "./dialog-model-free"
import { FavoriteMarker, isFreeModel, prioritizeFavorites, sortModelOptions } from "./model-options"

export function DialogModel(props: { integrationID?: string }) {
  const local = useLocal()
  const dialog = useDialog()
  onMount(() => dialog.setSize("large"))
  const newDesigns = useNewDesigns()
  const connected = useConnected()

  const data = useData()
  const location = useLocation()
  const toast = useToast()

  function addModel() {
    const id = "huggingface"
    const browse = () => dialog.replace(() => <DialogModel integrationID={id} />)
    const integration = data.location.integration.list(location.ref)?.find((item) => item.id === id)
    if (
      integration?.connections.some((item) => !item.status) ||
      data.location.model.list(location.ref)?.some((model) => model.providerID === id && model.enabled)
    ) {
      browse()
      return
    }
    if (!integration) {
      toast.show({ variant: "info", message: "Hugging Face is unavailable in this project." })
      return
    }
    dialog.replace(() => <DialogIntegration integrationID={id} autoConnect onConnected={browse} />)
  }

  function select(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.current()
    if (cur && list.includes(cur)) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  function download() {
    dialog.replace(() => <DialogGGUF onSelect={select} />)
  }

  function connect() {
    dialog.replace(() => (
      <DialogIntegration
        onConnected={(integrationID) => dialog.replace(() => <DialogModel integrationID={integrationID} />)}
      />
    ))
  }

  return (
    <Show
      when={newDesigns() && !connected() && !props.integrationID}
      fallback={
        <DialogConnectedModels
          integrationID={props.integrationID}
          onSelect={select}
          onConnect={connect}
          onAdd={addModel}
          onDownload={download}
        />
      }
    >
      <DialogFreeModels onSelect={select} onConnect={connect} onAdd={addModel} onDownload={download} />
    </Show>
  )
}

function DialogConnectedModels(props: {
  // Lists only the models of this integration's providers, such as OpenCode's workspace and OpenCode Go.
  integrationID?: string
  onSelect: (providerID: string, modelID: string) => void
  onConnect: () => void
  onDownload: () => void
  onAdd: () => void
}) {
  const local = useLocal()
  const newDesigns = useNewDesigns()
  const data = useData()
  const location = useLocation()
  const [query, setQuery] = createSignal("")
  // Under new designs, favoriting does not reorder the list until the dialog is reopened.
  const favoritesAtOpen = [...local.model.favorite()]
  const favoritePriority = new Set(favoritesAtOpen.map(modelPreferenceKey))
  const isFavorite = (value: { providerID: string; modelID: string } | undefined) =>
    value !== undefined &&
    local.model.favorite().some((item) => item.providerID === value.providerID && item.modelID === value.modelID)
  // Under new designs the detail row shows the price, so the trailing slot only marks favorites.
  const trailing = (model: ModelInfo, favorite: boolean) => {
    if (newDesigns()) return favorite ? <FavoriteMarker /> : undefined
    return isFreeModel(model) ? "Free" : undefined
  }
  // OpenCode's own free models get their own group at the end of the list instead of joining "OpenCode".
  const freeGroup = (model: ModelInfo) =>
    newDesigns() && !props.integrationID && model.providerID === "opencode" && isFreeModel(model)

  const connected = useConnected()
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])

  const showExtra = createMemo(() => connected() && !props.integrationID)

  // Built apart from the query so that typing reuses the same options and the list keeps its rows instead of
  // rebuilding one per model on every key.
  const modelOptions = createMemo(() =>
    sortModelOptions(
      models()
        .filter((model) => model.status !== "deprecated")
        .filter(
          (model) =>
            !props.integrationID ||
            model.providerID === props.integrationID ||
            providers().get(model.providerID)?.integrationID === props.integrationID,
        )
        .filter((model) => props.integrationID !== "huggingface" || model.enabled)
        // A model's faster and slower speeds are chosen with the speed selector.
        .filter((model) => !local.model.isSpeed({ providerID: model.providerID, modelID: model.id }))
        .map((model) => {
          const provider = providers().get(model.providerID)
          const value = { providerID: model.providerID, modelID: model.id }
          const favorite = isFavorite(value)
          return {
            value,
            providerID: model.providerID,
            providerName: provider?.name ?? model.providerID,
            title: model.name,
            releaseDate: model.time.released,
            description: newDesigns() ? undefined : favorite ? "(Favorite)" : undefined,
            category: connected() ? (freeGroup(model) ? "Free" : (provider?.name ?? model.providerID)) : undefined,
            footer: trailing(model, favorite),
            // Search results name the provider inline. The trailing slot keeps the favorite marker instead of
            // falling back to the provider name.
            searchDescription: newDesigns() ? (provider?.name ?? model.providerID) : undefined,
            searchFooter: newDesigns() ? (trailing(model, favorite) ?? "") : undefined,
            free: isFreeModel(model),
            onSelect() {
              props.onSelect(model.providerID, model.id)
            },
          }
        }),
      connected(),
    ),
  )

  const options = createMemo(() => {
    const needle = query().trim()
    if (needle && props.integrationID === "huggingface") {
      const id = huggingFaceModelID(needle)
      if (id !== undefined) return modelOptions().filter((option) => option.value.modelID.toLowerCase() === id)
      return fuzzysort
        .go(needle, modelOptions(), { keys: ["title", (option) => option.value.modelID] })
        .map((item) => item.obj)
    }
    if (needle)
      return prioritizeFavorites(
        sortModelOptions(
          fuzzysort.go(needle, modelOptions(), { keys: ["title", "category"] }).map((item) => item.obj),
          false,
        ),
        favoritePriority,
      )

    const showSections = showExtra()
    const favorites = connected() ? (newDesigns() ? favoritesAtOpen : local.model.favorite()) : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const model = models().find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        const provider = providers().get(model.providerID)
        return [
          {
            key: item,
            value: { providerID: model.providerID, modelID: model.id },
            title: model.name,
            releaseDate: model.time.released,
            description: provider?.name ?? model.providerID,
            category,
            footer: trailing(model, isFavorite(item)),
            onSelect: () => {
              props.onSelect(model.providerID, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const listed = modelOptions().filter((option) => {
      if (!showSections) return true
      if (
        favorites.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID)
      )
        return false
      if (recents.some((item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID))
        return false
      return true
    })

    if (!connected()) return prioritizeFavorites(listed, favoritePriority)

    return [
      ...favoriteOptions,
      ...recentOptions,
      ...listed.filter((option) => option.category !== "Free"),
      ...listed.filter((option) => option.category === "Free"),
    ]
  })

  const title = createMemo(
    () =>
      (props.integrationID &&
        data.location.integration.list(location.ref)?.find((item) => item.id === props.integrationID)?.name) ||
      (props.integrationID === "huggingface" ? "Hugging Face models" : "Select model"),
  )

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      searchInTitle
      titlePlaceholder={
        props.integrationID === "huggingface" ? "Search or paste a Hugging Face model URL" : "Search models"
      }
      placeholder={props.integrationID === "huggingface" ? "Model name, ID, or Hub URL" : undefined}
      footer={
        props.integrationID === "huggingface" ? (
          <Link href="https://huggingface.co/models?pipeline_tag=text-generation">Browse Hugging Face</Link>
        ) : undefined
      }
      noMatchView={
        props.integrationID === "huggingface" ? (
          <text>No matching Hugging Face model is available in this project.</text>
        ) : undefined
      }
      options={options()}
      actions={[
        {
          command: "model.dialog.download",
          title: "Download and use",
          bind: "alt+d",
          selection: "none",
          onTrigger: props.onDownload,
        },
        {
          command: "model.dialog.add",
          title: "Add model",
          hidden: Boolean(props.integrationID),
          bind: "ctrl+n",
          selection: "none",
          onTrigger: props.onAdd,
        },
        {
          command: "model.dialog.provider",
          hidden: props.integrationID === "huggingface",
          title: newDesigns()
            ? connected()
              ? "connect integration"
              : "view all integrations"
            : connected()
              ? "Connect an integration"
              : "View all integrations",
          selection: "none",
          onTrigger: props.onConnect,
        },
        {
          command: "model.dialog.favorite",
          title: newDesigns() ? (option) => (isFavorite(option?.value) ? "unfavorite" : "favorite") : "Favorite",
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.standard()}
    />
  )
}
