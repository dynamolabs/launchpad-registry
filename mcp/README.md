# MCP server

Lets AI agents (Claude, Cursor, any MCP client) query the registry.

```json
{ "mcpServers": { "launchpad-registry": { "command": "node", "args": ["/path/to/launchpad-registry/mcp/server.mjs"] } } }
```
After `npm i -g launchpad-registry`: `"command": "launchpad-registry-mcp"`.

Tools: `lookup(chain, address)`, `get(id)`, `search(q, chain?, status?, model?)`, `frontends_of(id)`, `list_chains()`. Resource: `registry://launchpads`.
