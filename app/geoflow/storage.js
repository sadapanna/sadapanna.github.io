/* Local save/load of constructions in localStorage.
   Each file: {id, name, updatedAt, thumb, data} where data is Engine.serialize(). */

'use strict';

const Store = (() => {
  const INDEX_KEY = 'geo.files.index';
  const FILE_PREFIX = 'geo.file.';
  const AUTOSAVE_KEY = 'geo.autosave';

  function safeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  function listFiles() {
    const idx = safeGet(INDEX_KEY);
    return Array.isArray(idx) ? idx : [];
  }

  function saveIndex(idx) { safeSet(INDEX_KEY, idx); }

  function saveFile(id, name, data, thumb) {
    id = id || 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const meta = { id, name, updatedAt: Date.now(), thumb: thumb || null };
    const ok = safeSet(FILE_PREFIX + id, data);
    if (!ok) return null;
    const idx = listFiles().filter((f) => f.id !== id);
    idx.unshift(meta);
    saveIndex(idx);
    return meta;
  }

  function loadFile(id) { return safeGet(FILE_PREFIX + id); }

  function deleteFile(id) {
    try { localStorage.removeItem(FILE_PREFIX + id); } catch {}
    saveIndex(listFiles().filter((f) => f.id !== id));
  }

  function renameFile(id, name) {
    const idx = listFiles();
    const f = idx.find((x) => x.id === id);
    if (f) { f.name = name; saveIndex(idx); }
  }

  function autosave(state) { safeSet(AUTOSAVE_KEY, state); }
  function loadAutosave() { return safeGet(AUTOSAVE_KEY); }

  return { listFiles, saveFile, loadFile, deleteFile, renameFile, autosave, loadAutosave };
})();

window.Store = Store;
