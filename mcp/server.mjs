#!/usr/bin/env node
// MCP server (stdio) exposing the registry to AI agents.
// Run: node mcp/server.mjs   (or `npx launchpad-registry-mcp` after install)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isMain } from '../lib/files.mjs';
import { launchpads, chains, meta, byId, lookup, forChain, frontendsOf } from '../index.mjs';

const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/** Compact view of an entry for list-style answers. */
const slim = (l) => ({
  id: l.id,
  name: l.name,
  chain: l.chain,
  status: l.status,
  model: l.model,
  builtOn: l.builtOn,
  website: l.website,
  contracts: l.contracts.map((c) => ({ address: c.address, role: c.role, label: c.label })),
  launch: l.launch,
  token: l.token,
  graduation: l.graduation,
  tags: l.tags,
});

/** Free-text search over id, name, tags, website, addresses and builtOn. Exported for tests. */
export function search({ q, chain, status, model, limit = 20 }) {
  const needle = (q || '').toLowerCase();
  const haystack = (l) =>
    JSON.stringify([
      l.id,
      l.name,
      l.tags,
      l.website,
      l.contracts.map((c) => c.address),
      l.builtOn,
    ]).toLowerCase();
  return (chain ? forChain(chain) : launchpads)
    .filter((l) => !status || l.status === status)
    .filter((l) => !model || l.model === model)
    .filter((l) => !needle || haystack(l).includes(needle))
    .slice(0, limit)
    .map(slim);
}

export function createServer() {
  const server = new McpServer({ name: 'launchpad-registry', version: meta.version });

  server.tool(
    'lookup',
    'Which launchpad owns this address on this chain? chain = registry dir (solana, evm-4663…) or {family,id}.',
    { chain: z.string(), address: z.string() },
    async ({ chain, address }) =>
      json(
        lookup(chain, address).map((h) => ({
          id: h.launchpad.id,
          name: h.launchpad.name,
          role: h.role,
          label: h.label,
          status: h.launchpad.status,
        })),
      ),
  );

  server.tool('get', 'Full registry entry by id.', { id: z.string() }, async ({ id }) =>
    json(byId(id) ?? { error: 'unknown id' }),
  );

  server.tool(
    'search',
    'Search launchpads by free text (name, id, tag, address, website) with optional chain/status/model filters.',
    {
      q: z.string().optional(),
      chain: z.string().optional(),
      status: z.enum(['active', 'inactive', 'test', 'unknown']).optional(),
      model: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async (args) => json(search(args)),
  );

  server.tool(
    'frontends_of',
    'Branded frontends built on a multi-tenant launchpad program (e.g. raydium-launchlab, meteora-dbc).',
    { id: z.string() },
    async ({ id }) => json(frontendsOf(id).map(slim)),
  );

  server.tool('list_chains', 'Chains covered by the registry with counts.', {}, async () =>
    json({
      generated: meta.generated,
      version: meta.version,
      chains: chains.map((c) => ({
        ...c,
        count: meta.chains.find((x) => x.dir === c.dir)?.count ?? 0,
      })),
    }),
  );

  server.resource('launchpads', 'registry://launchpads', async () => ({
    contents: [
      {
        uri: 'registry://launchpads',
        mimeType: 'application/json',
        text: JSON.stringify(launchpads),
      },
    ],
  }));

  return server;
}

if (isMain(import.meta.url)) await createServer().connect(new StdioServerTransport());
