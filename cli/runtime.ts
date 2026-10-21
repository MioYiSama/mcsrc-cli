import 'fake-indexeddb/auto';
import { setMaxListeners } from 'node:events';
import { Worker as NodeThread } from 'node:worker_threads';
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs';
import type { Endpoint } from 'comlink';
import { cacheStorage } from './cache.ts';

const workers = new Set<NodeWorker>();
const { promise: runtimeFailure, reject: rejectFailure } = Promise.withResolvers<never>();
export { runtimeFailure };
void runtimeFailure.catch(() => {});
let installed = false;

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

export function installPlatform(): void {
  if (installed) return;
  installed = true;
  const localStorage = new MemoryStorage();
  const navigator = { hardwareConcurrency: 2 };
  const window = Object.assign(new EventTarget(), {
    location: new URL('https://mcsrc.dev/'), localStorage, navigator,
    caches: cacheStorage, indexedDB: globalThis.indexedDB,
  });
  // Browser EventTarget has no Node listener limit; each original Setting registers once.
  setMaxListeners(0, window);
  const events = new EventTarget();
  defineGlobal('window', window);
  defineGlobal('self', globalThis);
  defineGlobal('localStorage', localStorage);
  defineGlobal('navigator', navigator);
  defineGlobal('caches', cacheStorage);
  defineGlobal('addEventListener', events.addEventListener.bind(events));
  defineGlobal('removeEventListener', events.removeEventListener.bind(events));
  defineGlobal('dispatchEvent', events.dispatchEvent.bind(events));
}

export function installRuntime(): void {
  installPlatform();
  defineGlobal('Worker', NodeWorker);
}

export async function stopWorkers(): Promise<void> {
  await Promise.all([...workers].map(worker => worker.terminate()));
}

class NodeWorker {
  readonly #thread: NodeThread;
  #terminating = false;
  readonly postMessage: Endpoint['postMessage'];
  readonly addEventListener: Endpoint['addEventListener'];
  readonly removeEventListener: Endpoint['removeEventListener'];

  constructor(url: string | URL, options?: WorkerOptions) {
    if (options?.name !== 'jar-remapper') throw new Error(`Unsupported Node worker: ${options?.name} (${url})`);
    this.#thread = new NodeThread(new URL('./remap-worker.js', import.meta.url), { name: options.name });
    const endpoint = nodeEndpoint(this.#thread);
    this.postMessage = endpoint.postMessage;
    this.addEventListener = endpoint.addEventListener;
    this.removeEventListener = endpoint.removeEventListener;
    this.#thread.on('error', error => rejectFailure(error));
    this.#thread.on('exit', code => {
      workers.delete(this);
      if (!this.#terminating) rejectFailure(new Error(`Remap worker exited unexpectedly (${code})`));
    });
    workers.add(this);
  }

  async terminate(): Promise<void> {
    this.#terminating = true;
    await this.#thread.terminate();
    workers.delete(this);
  }
}
