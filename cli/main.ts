import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { format, parseArgs } from 'node:util';
import { EmptyError, firstValueFrom, of } from 'rxjs';
import { configureJarCache } from './cache.ts';
import { ensureJava } from './java.mjs';

const USAGE = `Usage: mcsrc --list
       mcsrc --client <version> --output <dir>

  --list              Print all launcher version IDs
  --client <version>  Minecraft version to decompile
  --output <dir>      Directory for client.jar and sources/
  -h, --help          Show this help
`;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

type Command =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'client'; client: string; output: string };

type Gate = <T>(start: () => Promise<T>) => Promise<T>;

const reported = new Set<unknown>();

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message || error.stack || error.name;
  return String(error);
}

function report(error: unknown): void {
  if (reported.has(error)) return;
  reported.add(error);
  process.stderr.write(`mcsrc: ${formatError(error)}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${USAGE}`);
  process.exitCode = 1;
}

function redirectConsoleLog(): void {
  console.log = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };
}

function parseCommand(args: string[]): Command {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: {
        list: { type: 'boolean' },
        client: { type: 'string' },
        output: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (args.length === 0 || parsed.values.help) return { kind: 'help' };

    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new UsageError(`Option '${token.rawName}' was specified more than once`);
      seen.add(token.name);
    }

    const { list, client, output } = parsed.values;
    if (list) {
      if (client !== undefined || output !== undefined) {
        throw new UsageError('--list cannot be combined with --client or --output');
      }
      return { kind: 'list' };
    }
    if (client === undefined || client.trim() === '') throw new UsageError('Missing required option --client <version>');
    if (output === undefined || output.trim() === '') throw new UsageError('Missing required option --output <dir>');
    return { kind: 'client', client, output };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(formatError(error));
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function clientDownload(manifest: unknown, versionId: string): { url: string; sha1: string | undefined } {
  const client = asRecord(asRecord(manifest)?.downloads)?.client;
  const fields = asRecord(client);
  const url = fields?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(`No client jar is published for Minecraft ${versionId}`);
  }
  const sha1 = fields?.sha1;
  return { url, sha1: typeof sha1 === 'string' && sha1.length > 0 ? sha1 : undefined };
}

function watchLoadProgress(
  versionId: string,
  progress: { subscribe(onNext: (value: { version: string; stage: string; percent: number } | undefined) => void): { unsubscribe(): void } },
): () => void {
  let stage: string | undefined;
  let decade = -1;
  const subscription = progress.subscribe(value => {
    if (!value || value.version !== versionId) return;
    const nextDecade = Math.floor(value.percent / 10);
    if (value.stage === stage && nextDecade === decade) return;
    stage = value.stage;
    decade = nextDecade;
    process.stderr.write(`${value.version} ${value.stage} ${nextDecade * 10}%\n`);
  });
  return () => subscription.unsubscribe();
}

function isRejection(value: unknown): value is Promise<never> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<never>).then === 'function';
}

// Attach a handler before any later await. A worker can reject this between
// operations; without a handler that rejection is unhandled and the next step continues.
function trackFailure(failure: Promise<never> | undefined): Gate {
  if (!failure) return start => start();
  let rejected: unknown;
  let failed = false;
  void failure.catch(error => {
    rejected = error;
    failed = true;
    report(error);
  });
  return function gate<T>(start: () => Promise<T>): Promise<T> {
    if (failed) return Promise.reject(rejected);
    const work = start();
    // The race may settle on runtimeFailure first; still observe this step's later rejection.
    void work.catch(() => {});
    return Promise.race([work, failure]);
  };
}

async function listVersions(gate: Gate): Promise<void> {
  // Static import would run before installRuntime(); the module reads localStorage, navigator, and window at init.
  const { fetchLauncherVersions } = await gate(() => import('../src/logic/MinecraftApi.ts'));
  const versions = await gate(() => firstValueFrom(fetchLauncherVersions()));
  for (const version of versions) process.stdout.write(`${version.id}\n`);
}

async function exportClient(gate: Gate, versionId: string, output: string): Promise<void> {
  // Static import would run before installRuntime(); the module reads localStorage, navigator, and window at init.
  const { fetchLauncherVersions, fetchLauncherVersionManifest, minecraftVersions, minecraftJarPipeline, minecraftLoadProgress } =
    await gate(() => import('../src/logic/MinecraftApi.ts'));
  const versions = await gate(() => firstValueFrom(fetchLauncherVersions()));
  const entry = versions.find(version => version.id === versionId);
  if (!entry) throw new Error(`Unknown Minecraft version '${versionId}'`);

  // Settings also reads localStorage and navigator while the module initializes.
  const { agreedEula } = await gate(() => import('../src/logic/Settings.ts'));
  agreedEula.value = true;
  const supported = await gate(() => firstValueFrom(minecraftVersions));
  if (!supported.some(version => version.id === entry.id)) {
    throw new Error(`Minecraft ${entry.id} is listed but not supported for decompilation`);
  }

  const manifest = await gate(() => firstValueFrom(fetchLauncherVersionManifest(entry)));
  const client = clientDownload(manifest, entry.id);
  const outputDirectory = resolve(output);
  await gate(async () => {
    await mkdir(outputDirectory, { recursive: true });
    configureJarCache(client.url, client.sha1, outputDirectory);
  });
  await gate(() => ensureJava());
  // Static import would construct DecompileWorker and load generated Java before ensureJava().
  const { exportSources } = await gate(() => import('./export.ts'));

  const stopProgress = watchLoadProgress(entry.id, minecraftLoadProgress);
  try {
    const jar = await gate(() => firstValueFrom(minecraftJarPipeline(of(entry.id))).catch(error => {
      if (error instanceof EmptyError) throw new Error(`Minecraft ${entry.id} did not produce a client jar`);
      throw error;
    }));
    const count = await gate(() => exportSources(jar, outputDirectory));
    const sources = join(outputDirectory, 'sources');
    process.stderr.write(`Exported ${count} sources to ${sources}\n`);
    process.stdout.write(`${sources}\n`);
  } finally {
    stopProgress();
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  if (command.kind === 'help') {
    process.stdout.write(USAGE);
    return;
  }

  // Static import would load the worker runtime for --help and invalid flags.
  const runtime = await import('./runtime.ts');
  const failure = isRejection(runtime.runtimeFailure) ? runtime.runtimeFailure : undefined;
  const gate = trackFailure(failure);
  try {
    runtime.installRuntime();
    redirectConsoleLog();
    const operation = command.kind === 'list' ? listVersions(gate) : exportClient(gate, command.client, command.output);
    // If runtimeFailure wins the race, this operation can still reject later.
    void operation.catch(() => {});
    await (failure ? Promise.race([operation, failure]) : operation);
  } finally {
    await runtime.stopWorkers().catch(error => report(error));
  }
}

await main().catch(error => report(error));
