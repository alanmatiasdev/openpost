#!/usr/bin/env bun

import { lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export const defaultTurboCacheMaxMiB = 512;

const cacheEntryPattern = /^(?<hash>[0-9a-f]{16})(?<kind>\.tar\.zst|-manifest\.json|-meta\.json)$/u;
const completeEntryKinds = new Set([".tar.zst", "-manifest.json", "-meta.json"]);
const cacheLockFilename = "openpost-cache.lock";

export function turboCacheMaxBytes(environment = process.env) {
  const raw = environment.OPENPOST_TURBO_CACHE_MAX_MIB ?? String(defaultTurboCacheMaxMiB);
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`OPENPOST_TURBO_CACHE_MAX_MIB must be a positive integer; received: ${raw}`);
  }
  return Number(raw) * 1024 * 1024;
}

export async function pruneTurboCache({ directory, maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(
      `Turbo cache maximum must be a positive integer byte count; received: ${maxBytes}`,
    );
  }

  let directoryEntries;
  try {
    directoryEntries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { beforeBytes: 0, afterBytes: 0, removedBytes: 0, removedEntries: 0 };
    }
    throw error;
  }

  const groups = new Map();
  let unknownBytes = await allocatedPathBytes(directory, { recurse: false });
  for (const entry of directoryEntries) {
    const pathname = path.join(directory, entry.name);
    let file;
    try {
      file = await lstat(pathname);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const bytes = allocatedBytes(file);
    const match = cacheEntryPattern.exec(entry.name);
    if (!entry.isFile() || !match) {
      unknownBytes += entry.isDirectory()
        ? await allocatedPathBytes(pathname, { recurse: true })
        : bytes;
      continue;
    }
    const hash = match.groups.hash;
    const group = groups.get(hash) ?? {
      hash,
      files: [],
      kinds: new Set(),
      bytes: 0,
      modifiedAt: 0,
    };
    group.files.push(pathname);
    group.kinds.add(match.groups.kind);
    group.bytes += bytes;
    group.modifiedAt = Math.max(group.modifiedAt, file.mtimeMs);
    groups.set(hash, group);
  }

  const ordered = [...groups.values()].sort(
    (left, right) => right.modifiedAt - left.modifiedAt || right.hash.localeCompare(left.hash),
  );
  const beforeBytes = unknownBytes + ordered.reduce((total, entry) => total + entry.bytes, 0);
  let retainedBytes = unknownBytes;
  let removedBytes = 0;
  let removedEntries = 0;

  for (const entry of ordered) {
    const complete =
      entry.files.length === completeEntryKinds.size &&
      [...completeEntryKinds].every((kind) => entry.kinds.has(kind));
    if (complete && retainedBytes + entry.bytes <= maxBytes) {
      retainedBytes += entry.bytes;
      continue;
    }
    for (const pathname of entry.files) {
      try {
        await unlink(pathname);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    removedBytes += entry.bytes;
    removedEntries += 1;
  }

  const afterBytes = beforeBytes - removedBytes;
  if (afterBytes > maxBytes) {
    throw new Error(
      `Turbo cache still uses ${formatBytes(afterBytes)} after pruning because unrecognized files use ${formatBytes(unknownBytes)}`,
    );
  }
  return { beforeBytes, afterBytes, removedBytes, removedEntries };
}

export async function withTurboCacheLock({ directory, timeoutMs = 30 * 60 * 1000 }, operation) {
  const lockPath = path.join(path.dirname(directory), cacheLockFilename);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt })}\n`);
      await handle.close();
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockPath, timeoutMs)) continue;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for the Turbo cache lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  let releaseError;
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") releaseError = error;
  }
  if (operationError && releaseError) {
    throw new AggregateError(
      [operationError, releaseError],
      "Turbo cache work and lock release failed",
    );
  }
  if (operationError) throw operationError;
  if (releaseError) throw releaseError;
  return result;
}

export function formatPruneResult(result, maxBytes) {
  if (result.removedEntries === 0) return undefined;
  return (
    `Turbo cache pruned: ${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)} ` +
    `(${result.removedEntries} entries removed; maximum ${formatBytes(maxBytes)}).`
  );
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function allocatedBytes(file) {
  return Number.isSafeInteger(file.blocks) && file.blocks > 0 ? file.blocks * 512 : file.size;
}

async function allocatedPathBytes(pathname, { recurse }) {
  let file;
  try {
    file = await lstat(pathname);
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let bytes = allocatedBytes(file);
  if (!recurse || !file.isDirectory()) return bytes;
  for (const entry of await readdir(pathname)) {
    bytes += await allocatedPathBytes(path.join(pathname, entry), { recurse: true });
  }
  return bytes;
}

async function removeStaleLock(lockPath, timeoutMs) {
  let owner;
  let lock;
  try {
    [owner, lock] = await Promise.all([readFile(lockPath, "utf8"), lstat(lockPath)]);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }

  let pid;
  try {
    pid = JSON.parse(owner).pid;
  } catch {
    pid = undefined;
  }
  if (Number.isSafeInteger(pid) && processIsAlive(pid)) return false;
  if (!Number.isSafeInteger(pid) && Date.now() - lock.mtimeMs < timeoutMs) return false;
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return true;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

if (import.meta.main) {
  const command = process.argv[2] ?? "prune";
  if (command !== "prune") throw new Error(`Unsupported Turbo cache command: ${command}`);
  const directory = path.resolve(
    process.env.OPENPOST_TURBO_CACHE_DIR ?? path.join(import.meta.dir, "..", ".turbo", "cache"),
  );
  const maxBytes = turboCacheMaxBytes();
  const result = await withTurboCacheLock({ directory }, () =>
    pruneTurboCache({ directory, maxBytes }),
  );
  const message = formatPruneResult(result, maxBytes);
  if (message) console.log(message);
}
