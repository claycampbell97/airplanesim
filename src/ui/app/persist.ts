// Save games. Saves can run to a few megabytes, so they live in IndexedDB rather
// than localStorage; small preferences use localStorage.

const DB_NAME = 'skyledger';
const STORE = 'saves';

export interface SaveMeta {
  slot: string;
  airline: string;
  code: string;
  hq: string;
  /** Game time in minutes. */
  time: number;
  cash: number;
  fleet: number;
  savedAt: number;
  difficulty: string;
  color: string;
}

interface SaveRecord extends SaveMeta {
  data: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function writeSave(meta: SaveMeta, data: string): Promise<void> {
  await request('readwrite', (s) => s.put({ ...meta, data } satisfies SaveRecord));
}

export async function readSave(slot: string): Promise<string | null> {
  const rec = await request<SaveRecord | undefined>('readonly', (s) => s.get(slot));
  return rec?.data ?? null;
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const all = await request<SaveRecord[]>('readonly', (s) => s.getAll());
    return all.map(({ data: _data, ...meta }) => meta).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function eraseSave(slot: string): Promise<void> {
  await request('readwrite', (s) => s.delete(slot));
}

// ───────────── Preferences ─────────────

const PREFS_KEY = 'skyledger.prefs';

export function loadPrefs<T extends object>(defaults: T): T {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<T>) } : defaults;
  } catch {
    return defaults;
  }
}

export function savePrefs(prefs: object): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or a full disk: preferences simply will not persist.
  }
}

/** Offers a file to the user as a download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
