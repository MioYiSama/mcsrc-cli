import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const generated = resolve(directory, 'java-build/generated/teavm');

await build({
  absWorkingDir: directory,
  entryPoints: { main: 'main.ts', 'remap-worker': 'remap-worker.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  plugins: [{
    name: 'node-teavm-assets',
    setup(build) {
      build.onResolve({ filter: /\?url$/ }, ({ path }) => ({ path, namespace: 'node-asset' }));
      build.onResolve({ filter: /^@katana-project\/zip$/ }, () => ({
        path: fileURLToPath(import.meta.resolve('@katana-project/zip')),
      }));
      build.onLoad({ filter: /.*/, namespace: 'node-asset' }, ({ path }) => {
        const name = path.slice(0, -4);
        const javaPath = name.split('java/build/generated/teavm/')[1];
        const filename = javaPath ? resolve(generated, javaPath) : require.resolve(name);
        return { contents: `export default ${JSON.stringify(filename)};`, loader: 'js' };
      });
      build.onResolve({ filter: /java\/build\/generated\/teavm\// }, ({ path }) => ({
        path: resolve(generated, path.split('java/build/generated/teavm/')[1]),
        external: true,
      }));
    },
  }],
});
