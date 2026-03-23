import path from 'path';

const PENDING_BLANK_THREAD_TTL_MS = 10 * 60 * 1000;
const pendingDesktopProjects = new Map();
const pendingBlankThreads = new Map();

function normalizeProjectKey(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const normalized = path.resolve(path.normalize(inputPath.trim()));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function inferDisplayName(projectPath) {
  const resolved = path.resolve(projectPath);
  const base = path.basename(resolved);
  return base || resolved;
}

export function getPendingDesktopProjects() {
  return Array.from(pendingDesktopProjects.values())
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((entry) => ({
      projectPath: entry.projectPath,
      displayName: entry.displayName,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      pendingBlankThread: pendingBlankThreads.has(entry.key),
    }));
}

export function upsertPendingDesktopProject(projectPath, metadata = {}) {
  const key = normalizeProjectKey(projectPath);
  if (!key) {
    return null;
  }

  const now = Date.now();
  const existing = pendingDesktopProjects.get(key);
  const next = {
    key,
    projectPath: path.resolve(projectPath),
    displayName: metadata.displayName || existing?.displayName || inferDisplayName(projectPath),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  pendingDesktopProjects.set(key, next);
  return { ...next };
}

export function clearPendingDesktopProject(projectPath) {
  const key = normalizeProjectKey(projectPath);
  if (!key) {
    return false;
  }
  return pendingDesktopProjects.delete(key);
}

export function setPendingBlankThread(projectPath, metadata = {}) {
  const key = normalizeProjectKey(projectPath);
  if (!key) {
    return null;
  }

  const now = Date.now();
  const record = {
    key,
    projectPath: path.resolve(projectPath),
    knownSessionIds: Array.isArray(metadata.knownSessionIds)
      ? metadata.knownSessionIds.filter((value) => typeof value === 'string' && value.trim())
      : [],
    windowHandle:
      typeof metadata.windowHandle === 'number' && Number.isFinite(metadata.windowHandle)
        ? metadata.windowHandle
        : null,
    createdAt: now,
    updatedAt: now,
  };

  pendingBlankThreads.set(key, record);
  upsertPendingDesktopProject(projectPath, metadata);
  return { ...record };
}

export function getPendingBlankThread(projectPath) {
  const key = normalizeProjectKey(projectPath);
  if (!key) {
    return null;
  }

  const existing = pendingBlankThreads.get(key);
  if (!existing) {
    return null;
  }

  if (Date.now() - existing.createdAt > PENDING_BLANK_THREAD_TTL_MS) {
    pendingBlankThreads.delete(key);
    return null;
  }

  return { ...existing };
}

export function clearPendingBlankThread(projectPath) {
  const key = normalizeProjectKey(projectPath);
  if (!key) {
    return false;
  }
  return pendingBlankThreads.delete(key);
}
