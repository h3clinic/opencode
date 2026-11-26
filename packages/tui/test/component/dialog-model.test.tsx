import { expect, spyOn, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { DialogModel } from "../../src/component/dialog-model"
import { model, renderLocal } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

test("lists models of a provider declared only in config", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [
      {
        ...model("free"),
        providerID: "opencode",
        name: "Free Model",
        cost: [freeCost],
      },
      { ...model("local"), providerID: "ollama", name: "Local Model" },
    ],
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            {
              id: "ollama",
              name: "Ollama",
              methods: [{ type: "key" }],
              connections: [],
            },
          ],
        })
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              activation: "auto",
              package: "opencode",
            },
            {
              id: "ollama",
              name: "Ollama",
              activation: "enabled",
              package: "openai-compatible",
            },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Free models")
  expect(frame).toContain("Local Model")
})

test("opens the free models list without a connection or a configured provider", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [
      {
        ...model("free"),
        providerID: "opencode",
        name: "Free Model",
        cost: [freeCost],
      },
    ],
    fetch: (url) => {
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              activation: "auto",
              package: "opencode",
            },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Free models")
})

test("checks the connection in the session location instead of the launch directory", async () => {
  const sessionDirectory = `${directory}/session`
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    fetch: (url) => {
      const location = { directory: url.searchParams.get("location[directory]") ?? directory }
      const inSession = location.directory === sessionDirectory
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            { ...model("free"), providerID: "opencode", name: "Free Model", cost: [freeCost] },
            ...(inSession ? [{ ...model("paid"), providerID: "deepseek", name: "Paid Model" }] : []),
          ],
        })
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: inSession
            ? [
                {
                  id: "deepseek",
                  name: "DeepSeek",
                  methods: [{ type: "key" }],
                  connections: [{ type: "credential", id: "cred_1", label: "Key", active: true }],
                },
              ]
            : [],
        })
      if (url.pathname === "/api/provider")
        return json({
          location,
          data: [
            { id: "opencode", name: "OpenCode", activation: "auto", package: "opencode" },
            ...(inSession
              ? [{ id: "deepseek", name: "DeepSeek", integrationID: "deepseek", activation: "enabled", package: "deepseek" }]
              : []),
          ],
        })
    },
  })
  setup.location.set({ directory: sessionDirectory })
  await setup.data.location.sync({ directory: sessionDirectory })
  setup.dialog.replace(() => <DialogModel />)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Free models")
  expect(frame).toContain("Paid Model")
})

test("lists every provider of the integration just connected", async () => {
  await using setup = await renderLocal({
    config: { experimental: { "new-designs": true } },
    models: [
      { ...model("zen"), providerID: "opencode", name: "Zen Model" },
      { ...model("go"), providerID: "opencode-go", name: "Go Model" },
      { ...model("local"), providerID: "ollama", name: "Local Model" },
    ],
    fetch: (url) => {
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              methods: [{ type: "oauth", label: "OpenCode account" }],
              connections: [{ type: "credential", id: "cred_1", label: "Personal", active: true }],
            },
          ],
        })
      if (url.pathname === "/api/provider")
        return json({
          location: { directory },
          data: [
            {
              id: "opencode",
              name: "Personal / OpenCode",
              integrationID: "opencode",
              activation: "enabled",
              package: "opencode",
            },
            {
              id: "opencode-go",
              name: "OpenCode Go",
              integrationID: "opencode",
              activation: "enabled",
              package: "opencode",
            },
            { id: "ollama", name: "Ollama", activation: "enabled", package: "openai-compatible" },
          ],
        })
    },
  })
  setup.dialog.replace(() => <DialogModel integrationID="opencode" />)
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Zen Model")
  expect(frame).toContain("Go Model")
  expect(frame).not.toContain("Local Model")
})

const freeCost = {
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}

test("Add model opens Hugging Face and selects the pasted Hub model for this session", async () => {
  const id = "Qwen/Qwen3-Coder-Next"
  await using setup = await renderLocal({
    models: [
      model("first"),
      { ...model(id), providerID: "huggingface", name: "Qwen Coder" },
      { ...model("another/coder"), providerID: "huggingface", name: "Another coder" },
    ],
  })
  setup.dialog.replace(() => <DialogModel />)
  const frame = await setup.waitForFrame((frame) => frame.includes("Add model"))
  const rows = frame.split("\n")
  const y = rows.findIndex((row) => row.includes("Add model"))
  await setup.mockMouse.click(rows[y].indexOf("Add model"), y)
  await setup.waitForFrame((frame) => frame.includes("Browse Hugging") && frame.includes("Another coder"))
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
  await setup.mockInput.typeText("https://huggingface.co/" + id)
  await setup.waitForFrame((frame) => frame.includes("Qwen Coder") && !frame.includes("Another coder"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.model.current()).toEqual({ providerID: "huggingface", modelID: id })
})

test("Download and use confirms size before pulling and selects the discovered Ollama model", async () => {
  const repo = "test/coder-GGUF"
  const id = "hf.co/" + repo + ":latest"
  let pulled = false
  await using setup = await renderLocal({
    fetch: (url) => {
      if (url.pathname === "/api/model")
        return json({ location: { directory }, data: [model("first"), ...(pulled ? [{ ...model(id), providerID: "ollama" }] : [])] })
    },
  })
  using fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === "/api/models") return Response.json([{ id: repo }])
    if (url.pathname === "/api/version") return Response.json({ version: "test" })
    if (url.pathname.endsWith("/manifests/latest"))
      return Response.json({ layers: [{ mediaType: "application/vnd.ollama.image.model", size: 1048576 }] })
    if (url.pathname === "/api/pull") {
      pulled = true
      return new Response('{"status":"pulling","completed":9,"total":10}\n{"status":"success"}\n')
    }
    if (url.pathname === "/api/tags") return Response.json({ models: pulled ? [{ model: id }] : [] })
    if (url.pathname === "/api/show")
      return Response.json({ details: { format: "gguf" }, capabilities: ["completion", "tools"] })
    throw new Error("Unexpected request: " + url)
  })
  setup.dialog.replace(() => <DialogModel />)
  const frame = await setup.waitForFrame((frame) => frame.includes("Download and use"))
  const rows = frame.split("\n")
  const y = rows.findIndex((row) => row.includes("Download and use"))
  await setup.mockMouse.click(rows[y].indexOf("Download and use"), y)
  await setup.waitForFrame((frame) => frame.includes(repo))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Use local GGUF model") && frame.includes("GiB"))
  expect(pulled).toBe(false)
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.model.current()).toEqual({ providerID: "ollama", modelID: id })
})
