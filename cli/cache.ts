import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let configuration: { url: string; sha1?: string; outputDirectory: string } | undefined;
let clientValid: boolean | undefined;

export function configureJarCache(url: string, sha1: string | undefined, outputDirectory: string): void {
  configuration = { url, sha1, outputDirectory };
  clientValid = undefined;
}

async function sha1(path: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function hasClientJar(): Promise<boolean> {
  if (clientValid !== undefined) return clientValid;
  if (!configuration?.sha1) return clientValid = false;
  try {
    return clientValid = await sha1(join(configuration.outputDirectory, 'client.jar')) === configuration.sha1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return clientValid = false;
    throw error;
  }
}

function cachePath(name: string, url: string): string | undefined {
  if (!configuration) return undefined;
  if (url === configuration.url) return join(configuration.outputDirectory, 'client.jar');
  const key = createHash('sha256').update(`${name}\0${url}`).digest('hex');
  return join(configuration.outputDirectory, '.mcsrc-cache', key);
}

export const cacheStorage = {
  async open(name: string) {
    return {
      async match(url: string): Promise<Response | undefined> {
        const path = cachePath(name, url);
        if (!path || !await hasClientJar()) return undefined;
        try {
          await access(path);
          return new Response(await openAsBlob(path));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
      },
      async put(url: string, response: Response): Promise<void> {
        const path = cachePath(name, url);
        if (!path || !response.body) throw new Error(`Cannot cache response: ${url}`);
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        try {
          await pipeline(Readable.from(response.body), createWriteStream(temporary));
          if (url === configuration?.url && configuration.sha1 && await sha1(temporary) !== configuration.sha1) {
            throw new Error(`SHA-1 mismatch downloading ${url}`);
          }
          await rename(temporary, path);
          if (url === configuration?.url) clientValid = true;
        } finally {
          await rm(temporary, { force: true });
        }
      },
    };
  },
};
