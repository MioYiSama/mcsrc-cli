import { spawn } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function ensureJava() {
  const directory = dirname(fileURLToPath(import.meta.url));
  // Bundled entry points live one directory below the CLI sources.
  const cli = basename(directory) === 'dist' ? resolve(directory, '..') : directory;
  const wrapper = resolve(cli, '../java', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const args = ['-p', resolve(cli, '../java'), '--project-cache-dir', resolve(cli, '.gradle'),
    '--init-script', resolve(cli, 'java.init.gradle'), '--console=plain', '--quiet',
    'generateJavaScript', 'generateWasmGC', 'copyWasmGCRuntime'];
  const { promise, resolve: complete, reject } = Promise.withResolvers();
  const child = spawn(process.platform === 'win32' ? wrapper : 'sh',
    process.platform === 'win32' ? args : [wrapper, ...args], { stdio: ['ignore', 2, 2] });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) complete(undefined);
    else reject(new Error(`Original mcsrc Java build failed (${signal ?? code}); Java 25 is required.`));
  });
  await promise;
}
