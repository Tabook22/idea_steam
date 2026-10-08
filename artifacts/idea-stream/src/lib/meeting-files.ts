/**
 * Photos, documents and drawings added during a meeting are kept on this device first (like the
 * recording itself), then uploaded with it. A small IndexedDB store of files by note id.
 */
const DB = "idea-stream-meeting-files-v1";
const STORE = "files";
let opening: Promise<IDBDatabase> | null = null;

function open() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const putMeetingFile = (id: string, blob: Blob) => run("readwrite", (store) => store.put(blob, id)).then(() => undefined);
export const getMeetingFile = (id: string) => run<Blob | undefined>("readonly", (store) => store.get(id) as IDBRequest<Blob | undefined>);
export const deleteMeetingFile = (id: string) => run("readwrite", (store) => store.delete(id)).then(() => undefined);
