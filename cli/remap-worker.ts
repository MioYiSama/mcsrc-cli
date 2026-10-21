import { parentPort } from 'node:worker_threads';
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs';
import { installPlatform } from './runtime.ts';

if (!parentPort) throw new Error('The remapper must run in a Node worker thread');
installPlatform();
Object.assign(globalThis, nodeEndpoint(parentPort));
// The original worker exposes Comlink at import time, after the Node endpoint must exist.
await import('../src/workers/remap/worker.ts');
