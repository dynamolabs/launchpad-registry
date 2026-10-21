import { readFileSync, writeFileSync, renameSync } from 'node:fs';
export function openState(file, { maxSeen = 20000 } = {}) {
  let s = { seen: {}, entrypoints: {}, cursor: null };
  try { s = { ...s, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  let dirty = false;
  const save = () => { if (!dirty) return; const keys = Object.keys(s.seen); if (keys.length > maxSeen) for (const k of keys.slice(0, keys.length - maxSeen)) delete s.seen[k];
    writeFileSync(file + '.tmp', JSON.stringify(s)); renameSync(file + '.tmp', file); dirty = false; };
  setInterval(save, 5000).unref(); process.on('exit', save);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { save(); process.exit(0); });
  return { get: () => s, touch: () => { dirty = true; }, save };
}
