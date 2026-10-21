import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { getDecompilerOptions } from '../src/logic/Decompiler';
import type { MinecraftJar } from '../src/logic/MinecraftApi';
import { displayLambdas, preferWasmDecompiler } from '../src/logic/Settings';
import { DEFAULT_VERSION } from '../src/logic/vineflower/versions';
import { DecompileJar } from '../src/workers/decompile/types';
import { DecompileWorker } from '../src/workers/decompile/worker';

export async function exportSources(jar: MinecraftJar, outputDirectory: string): Promise<number> {
  const destination = join(outputDirectory, 'sources');
  let existing = false;
  try {
    const info = await lstat(destination);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${destination} must be a directory`);
    const files = await readdir(destination);
    if (files.length > 0 && !files.includes('.mcsrc')) {
      throw new Error(`Refusing to replace an existing, unmanaged sources directory: ${destination}`);
    }
    existing = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const staging = await mkdtemp(join(outputDirectory, '.mcsrc-export-'));
  const worker = new DecompileWorker(DEFAULT_VERSION);
  try {
    const classes = new DecompileJar(jar.jar).classes.filter(name => !name.includes('$'));
    if (classes.length === 0) throw new Error('The JAR contains no top-level Java classes');
    await worker.setOptions(getDecompilerOptions(displayLambdas.value), new SharedArrayBuffer(4));
    await worker.loadVFRuntime(preferWasmDecompiler.value, DEFAULT_VERSION);
    let count = 0;
    for (let offset = 0; offset < classes.length; offset += 100) {
      const batch = classes.slice(offset, offset + 100);
      await worker.decompileMany(jar.jar.name, jar.blob, batch, new SharedArrayBuffer(4), 100);
      const results = await worker.db.results6.toArray();
      const completed = new Set(results.filter(result => result.language === 'java').map(result => result.className));
      const missing = batch.filter(name => !completed.has(name));
      if (missing.length > 0) throw new Error(`Decompilation produced no source for: ${missing.join(', ')}`);
      for (const result of results) {
        const path = resolve(staging, `${result.className}.java`);
        const pathFromRoot = relative(staging, path);
        if (isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith('../')) {
          throw new Error(`Invalid source path: ${result.className}`);
        }
        await mkdir(resolve(path, '..'), { recursive: true });
        await writeFile(path, result.source);
        count++;
      }
      await worker.db.results6.clear();
      console.error(`Exported ${Math.min(offset + 100, classes.length)}/${classes.length} top-level classes`);
    }
    await writeFile(join(staging, '.mcsrc'), `${jar.version}\n`);
    const backup = join(outputDirectory, `.mcsrc-previous-${randomUUID()}`);
    if (existing) await rename(destination, backup);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (existing) await rename(backup, destination);
      throw error;
    }
    if (existing) await rm(backup, { recursive: true });
    return count;
  } finally {
    worker.db.close();
    await rm(staging, { recursive: true, force: true });
  }
}
