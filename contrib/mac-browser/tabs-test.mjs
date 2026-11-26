import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const fixture = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  const name = req.url === "/first" ? "First" : "Second";
  res.end(`<title>${name}</title><button onclick="document.body.innerText='Clicked ${name}'">Apply</button>`);
});
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${fixture.address().port}`;
const client = new Client({name:"tabs-test",version:"1"});
async function tool(name, args = {}) {
  const reply = await client.callTool({name, arguments:args});
  if (reply.isError) throw Error(reply.content[0].text);
  return JSON.parse(reply.content[0].text);
}
const created = [];
try {
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL("mcp.mjs", import.meta.url))],
    env:{OPENCODE_SIDEBROWSER_SOCKET:process.env.OPENCODE_SIDEBROWSER_SOCKET}}));
  const original = (await tool("tabs_list")).find(tab => tab.selected);
  try {
    for (const name of ["first","second"]) {
      const {tabID} = await tool("tabs_open");
      created.push(tabID);
      await tool("navigate", {tabID,url:`${url}/${name}`});
    }
    const [first,second] = created;
    assert.equal((await tool("tabs_list")).find(tab => tab.selected).tabID, second);
    const {controls} = await tool("snapshot", {tabID:first});
    const ref = controls[0].ref;
    await assert.rejects(tool("click",{tabID:second,ref}));
    await tool("click", {tabID:first,ref});
    assert.equal((await tool("snapshot",{tabID:first})).text, "Clicked First");
    assert.equal((await tool("snapshot")).text, "Apply");
    await tool("tabs_focus", {tabID:first});
    assert.equal((await tool("snapshot")).title, "First");
    await tool("tabs_close", {tabID:second});
    created.pop();
    await assert.rejects(tool("snapshot",{tabID:second}), /Unknown tab/);
    console.log("Passed tab creation, focus, targeted click, isolation, close and stale-ID checks.");
  } finally {
    for (const tabID of created) await tool("tabs_close",{tabID});
    await tool("tabs_focus",{tabID:original.tabID});
  }
} finally {
  await client.close();
  fixture.close();
}
