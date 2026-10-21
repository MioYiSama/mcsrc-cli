declare module '*/mcsrc.js';

declare module 'vf-1.11.2' {
  export type Options = import('vf-1.12.0').Options;
  export type Config = import('vf-1.12.0').Config;
  export const decompile: typeof import('vf-1.12.0').decompile;
}

declare module 'vf-*/vf.wasm-runtime.js' {
  export function load(source: string, options?: { noAutoImports?: boolean }): Promise<{
    exports: typeof import('vf-1.12.0');
  }>;
}

declare module 'vf-*/vf.runtime.js' {
  export const decompile: typeof import('vf-1.12.0').decompile;
}

declare module 'comlink/dist/esm/node-adapter.mjs' {
  export { default } from 'comlink/dist/esm/node-adapter';
}
