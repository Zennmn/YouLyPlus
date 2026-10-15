const restoreStates = new Map();
const pending = new Map();

// Window state changes give the same browser-chrome-free mode as F11.
export async function browserFullscreen(message, sender, api = globalThis.browser || globalThis.chrome) {
  const id = sender?.tab?.windowId;
  if (!Number.isInteger(id) || id < 0) throw new Error('Player window is unavailable');
  if (!['get', 'toggle'].includes(message.operation)) throw new Error('Invalid fullscreen action');
  if (!api?.windows?.get || !api?.windows?.update) throw new Error('Browser fullscreen is unavailable');
  const run = async () => {
    const current = await api.windows.get(id);
    if (message.operation === 'get') return { fullscreen: current.state === 'fullscreen' };
    const key = `lyplusWindowRestore_${id}`;
    let state;
    if (current.state === 'fullscreen') {
      const saved = api.storage?.session ? (await api.storage.session.get(key))[key] : restoreStates.get(id);
      state = saved === 'maximized' ? 'maximized' : 'normal';
    } else {
      const saved = current.state === 'maximized' ? 'maximized' : 'normal';
      if (api.storage?.session) await api.storage.session.set({ [key]: saved });
      else restoreStates.set(id, saved);
      state = 'fullscreen';
    }
    const updated = await api.windows.update(id, { state });
    return { fullscreen: updated.state === 'fullscreen' };
  };
  // Serialize a window's requests so rapid clicks cannot race each other.
  const result = (pending.get(id) || Promise.resolve()).catch(() => {}).then(run);
  pending.set(id, result);
  try { return await result; }
  finally { if (pending.get(id) === result) pending.delete(id); }
}
