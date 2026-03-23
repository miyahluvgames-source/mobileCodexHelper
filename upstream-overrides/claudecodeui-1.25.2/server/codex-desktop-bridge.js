import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import { getCodexSessionMessages } from './projects.js';
import {
  clearPendingBlankThread,
  clearPendingDesktopProject,
  getPendingBlankThread,
  setPendingBlankThread,
  upsertPendingDesktopProject,
} from './codex-desktop-bridge-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIN_STACK_ROOT = path.resolve(__dirname, '../../../../..');
const DESKTOP_CONTROL_SCRIPT = path.join(MAIN_STACK_ROOT, 'scripts', 'desktop-control.ps1');
const DESKTOP_STABLE_INPUT_SCRIPT = path.join(MAIN_STACK_ROOT, 'scripts', 'desktop-stable-input.ps1');
const GAME_AUTOMATION_PYTHON = path.join(
  MAIN_STACK_ROOT,
  '.venv-game-automation',
  'Scripts',
  'python.exe',
);
const GAME_CLICK_TEXT_SCRIPT = path.join(MAIN_STACK_ROOT, 'scripts', 'game_click_text.py');
const GAME_SIGNAL_PROBE_SCRIPT = path.join(MAIN_STACK_ROOT, 'scripts', 'game_signal_probe.py');
const OVERLAY_OCR_FIND_SCRIPT = path.join(MAIN_STACK_ROOT, 'scripts', 'overlay_ocr_find.py');
const CODEX_STATE_DB_PATH = path.join(os.homedir(), '.codex', 'state_5.sqlite');
const CODEX_SESSION_INDEX_PATH = path.join(os.homedir(), '.codex', 'session_index.jsonl');
const CODEX_DESKTOP_BRIDGE_MODE =
  process.env.CODEX_DESKTOP_BRIDGE_MODE === 'true' ||
  process.env.CODEX_DESKTOP_BRIDGE_MODE == null;

const activeDesktopBridgeSessions = new Map();
const desktopSelectionCache = new Map();
const sessionFingerprintCache = new Map();

const INPUT_CLICK_POINT = { x_ratio: 0.48, y_ratio: 0.885 };
const SUBMIT_CLICK_POINT = { x_ratio: 0.965, y_ratio: 0.93 };
const CODEX_SIDEBAR_TEXT_ROI = { x_ratio: 0.0, y_ratio: 0.12, w_ratio: 0.34, h_ratio: 0.84 };
const CODEX_HEADER_ROI = { x_ratio: 0.27, y_ratio: 0.0, w_ratio: 0.48, h_ratio: 0.12 };
const CODEX_CONTENT_ROI = { x_ratio: 0.27, y_ratio: 0.12, w_ratio: 0.68, h_ratio: 0.7 };
const POLL_INTERVAL_MS = 1200;
const IDLE_AFTER_ASSISTANT_MS = 3500;
const TOTAL_WAIT_MS = 180000;
const CODEX_PROJECT_ROW_MAX_LEFT = 48;
const CODEX_SESSION_ROW_MIN_LEFT = 28;
const CODEX_HEADER_MIN_LEFT_RATIO = 0.27;
const CODEX_HEADER_MAX_TOP_RATIO = 0.12;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coerceEpochMs(value) {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : 0;
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.resolve(path.normalize(withoutLongPathPrefix));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function toTextCodepoints(text) {
  return Array.from(text || '')
    .map((char) => char.codePointAt(0))
    .filter((value) => Number.isFinite(value))
    .join(',');
}

function normalizeOcrText(text) {
  return typeof text === 'string'
    ? text
        .normalize('NFKC')
        .replace(/\.\.\.$/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '')
        .toLowerCase()
    : '';
}

function buildOcrCandidates(text, maxLength = 28, minPrefixLength = 8) {
  const rawCandidates = buildSidebarMatchTexts(text, maxLength, minPrefixLength);
  return rawCandidates
    .map((candidate) => ({
      raw: candidate,
      normalized: normalizeOcrText(candidate),
    }))
    .filter((candidate) => candidate.normalized.length >= minPrefixLength);
}

function scoreNormalizedCandidate(ocrText, candidate) {
  if (!ocrText || !candidate) {
    return 0;
  }

  if (ocrText === candidate) {
    return 1000 + candidate.length;
  }

  if (ocrText.startsWith(candidate)) {
    return 800 + candidate.length;
  }

  if (candidate.startsWith(ocrText) && ocrText.length >= Math.min(12, candidate.length)) {
    return 700 + ocrText.length;
  }

  if (ocrText.includes(candidate)) {
    return 600 + candidate.length;
  }

  if (candidate.includes(ocrText) && ocrText.length >= Math.min(12, candidate.length)) {
    return 500 + ocrText.length;
  }

  return 0;
}

function findBestLineMatch(lines, candidates, predicate = () => true) {
  let best = null;

  for (const line of lines) {
    if (!predicate(line)) {
      continue;
    }

    const normalizedLine = normalizeOcrText(line.text);
    if (!normalizedLine) {
      continue;
    }

    for (const candidate of candidates) {
      const score = scoreNormalizedCandidate(normalizedLine, candidate.normalized);
      if (!score) {
        continue;
      }

      const ranked = {
        line,
        candidate,
        score,
      };

      if (
        !best ||
        ranked.score > best.score ||
        (ranked.score === best.score && line.score > best.line.score)
      ) {
        best = ranked;
      }
    }
  }

  return best;
}

function buildRelativeClickPayload(line, screenshotRect) {
  const centerX = Array.isArray(line.center) ? Number(line.center[0]) : 0;
  const centerY = Array.isArray(line.center) ? Number(line.center[1]) : 0;
  const width = Number(screenshotRect?.width || 0);
  const height = Number(screenshotRect?.height || 0);
  if (!width || !height) {
    throw new Error('Missing screenshot rect for relative click payload.');
  }

  return {
    x_ratio: Math.max(0, Math.min(1, centerX / width)),
    y_ratio: Math.max(0, Math.min(1, centerY / height)),
  };
}

function buildSidebarMatchTexts(text, maxLength = 28, minPrefixLength = 6) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return [];
  }

  const condensed = normalized.replace(/\s+/g, '');
  const compact = condensed.replace(/[^\p{L}\p{N}_-]/gu, '');
  const candidates = [];
  const pushCandidate = (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || trimmed.length < 3 || candidates.includes(trimmed)) {
      return;
    }
    candidates.push(trimmed);
  };

  for (const value of [normalized, condensed, compact]) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      continue;
    }

    if (trimmed.length <= maxLength) {
      pushCandidate(trimmed);
      continue;
    }

    for (let length = maxLength; length >= minPrefixLength; length -= 1) {
      pushCandidate(trimmed.slice(0, length));
    }
  }

  return candidates;
}

function buildProjectSidebarLabels({
  projectPath,
  projectName = '',
  projectDisplayName = '',
  threadPath = '',
} = {}) {
  const labels = [];
  const pushLabel = (value) => {
    const trimmed = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!trimmed || labels.includes(trimmed)) {
      return;
    }
    labels.push(trimmed);
  };

  const decodedProjectName =
    typeof projectName === 'string' && /^[A-Za-z]--/.test(projectName)
      ? projectName.replace(/^([A-Za-z])--/, '$1:/').replace(/-/g, '/')
      : '';

  for (const candidate of [projectDisplayName, projectName, decodedProjectName, threadPath, projectPath]) {
    if (!candidate || typeof candidate !== 'string') {
      continue;
    }

    pushLabel(candidate);

    try {
      const resolved = candidate.startsWith('\\\\?\\')
        ? path.resolve(candidate.slice(4))
        : path.resolve(candidate);
      pushLabel(path.basename(resolved));
    } catch {
      // Ignore non-path-like candidates.
    }
  }

  return labels;
}

async function readLatestSessionIndexTitle(sessionId) {
  if (!sessionId) {
    return null;
  }

  try {
    const content = await fs.readFile(CODEX_SESSION_INDEX_PATH, 'utf8');
    let latestTitle = null;
    let latestUpdatedAt = 0;

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line);
        if (entry.id !== sessionId) {
          continue;
        }

        const candidate = typeof entry.thread_name === 'string' ? entry.thread_name.trim() : '';
        if (!candidate) {
          continue;
        }

        const updatedAt = entry.updated_at ? new Date(entry.updated_at).getTime() : 0;
        if (updatedAt >= latestUpdatedAt) {
          latestUpdatedAt = updatedAt;
          latestTitle = candidate;
        }
      } catch {
        // Ignore malformed rows.
      }
    }

    return latestTitle;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function withStateDb(callback) {
  const db = await open({
    filename: CODEX_STATE_DB_PATH,
    driver: sqlite3.Database,
  });

  try {
    return await callback(db);
  } finally {
    await db.close();
  }
}

async function getDesktopThreadById(sessionId) {
  if (!sessionId) {
    return null;
  }

  return withStateDb(async (db) => {
    const row = await db.get(
      `SELECT id, rollout_path, created_at, updated_at, cwd, title, archived, source
       FROM threads
       WHERE id = ?
       LIMIT 1`,
      [sessionId],
    );

    if (!row) {
      return null;
    }

    const displayTitle = (await readLatestSessionIndexTitle(row.id)) || row.title || 'Codex Session';
    return {
      ...row,
      displayTitle,
    };
  });
}

async function getCurrentDesktopThread(projectPath) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);

  return withStateDb(async (db) => {
    const rows = await db.all(
      `SELECT id, rollout_path, created_at, updated_at, cwd, title, archived, source
       FROM threads
       WHERE archived = 0
         AND source = 'vscode'
       ORDER BY updated_at DESC
       LIMIT 20`,
    );

    const matchingRows = normalizedProjectPath
      ? rows.filter((row) => normalizeComparablePath(row.cwd) === normalizedProjectPath)
      : rows;
    const selected = matchingRows[0] || rows[0] || null;

    if (!selected) {
      return null;
    }

    const displayTitle =
      (await readLatestSessionIndexTitle(selected.id)) ||
      selected.title ||
      'Codex Session';

    return {
      ...selected,
      displayTitle,
    };
  });
}

async function getDesktopThreadsForProject(projectPath) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) {
    return [];
  }

  return withStateDb(async (db) => {
    const rows = await db.all(
      `SELECT id, rollout_path, created_at, updated_at, cwd, title, archived, source
       FROM threads
       WHERE archived = 0
         AND source = 'vscode'
       ORDER BY updated_at DESC
       LIMIT 200`,
    );

    return rows
      .filter((row) => normalizeComparablePath(row.cwd) === normalizedProjectPath)
      .map((row) => ({
        ...row,
      }));
  });
}

async function getDesktopThreadIdsForProject(projectPath) {
  const rows = await getDesktopThreadsForProject(projectPath);
  return rows
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
}

async function getDesktopProjectDescriptors() {
  return withStateDb(async (db) => {
    const rows = await db.all(
      `SELECT DISTINCT cwd
       FROM threads
       WHERE archived = 0
         AND source = 'vscode'
         AND cwd IS NOT NULL
         AND cwd <> ''
       ORDER BY LOWER(cwd) ASC`,
    );

    return rows
      .map((row) => {
        const projectPath = typeof row.cwd === 'string' ? row.cwd.trim() : '';
        if (!projectPath) {
          return null;
        }
        const resolvedPath = projectPath.startsWith('\\\\?\\')
          ? path.resolve(projectPath.slice(4))
          : path.resolve(projectPath);
        return {
          path: resolvedPath,
          displayName: path.basename(resolvedPath) || resolvedPath,
        };
      })
      .filter(Boolean);
  });
}

async function waitForNewDesktopThread(projectPath, knownSessionIds, sendStartedAtMs) {
  const known = new Set(Array.isArray(knownSessionIds) ? knownSessionIds : []);
  const deadline = Date.now() + TOTAL_WAIT_MS;

  while (Date.now() < deadline) {
    const threads = await getDesktopThreadsForProject(projectPath);
    const candidate = threads.find((thread) => {
      if (!thread?.id || known.has(thread.id)) {
        return false;
      }

      const updatedAt = coerceEpochMs(thread.updated_at) || coerceEpochMs(thread.created_at);
      return updatedAt >= sendStartedAtMs - 1500;
    });

    if (candidate) {
      const displayTitle =
        (await readLatestSessionIndexTitle(candidate.id)) || candidate.title || 'Codex Session';
      return {
        ...candidate,
        displayTitle,
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for Codex Desktop to materialize the new thread.');
}

async function waitForSessionStabilization(sessionId, sendStartedAtMs, writer) {
  let lastSignature = '';
  let lastTotal = 0;
  let lastChangeAt = Date.now();
  let sawAnyChange = false;
  let sawAssistant = false;

  while (Date.now() - sendStartedAtMs < TOTAL_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const current = await getCodexSessionMessages(sessionId, 60, 0);
    const currentMessages = current.messages || [];
    const signature = tailSignature(currentMessages);
    const total = current.total || currentMessages.length;
    const assistantMessages = recentAssistantMessages(currentMessages, sendStartedAtMs);

    if (signature !== lastSignature || total !== lastTotal) {
      sawAnyChange = true;
      if (assistantMessages.length > 0) {
        sawAssistant = true;
      }
      lastSignature = signature;
      lastTotal = total;
      lastChangeAt = Date.now();
    }

    if (sawAssistant && Date.now() - lastChangeAt >= IDLE_AFTER_ASSISTANT_MS) {
      sendMessage(writer, {
        type: 'websocket-reconnected',
        sessionId,
      });
      sendMessage(writer, {
        type: 'codex-complete',
        sessionId,
        actualSessionId: sessionId,
      });
      return;
    }
  }

  if (sawAnyChange) {
    throw new Error(
      'Desktop bridge observed session activity, but no assistant reply stabilized before timeout.',
    );
  }

  throw new Error('Desktop bridge did not observe any session update after submit.');
}

async function invokeDesktopControl(action, payload) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    DESKTOP_CONTROL_SCRIPT,
    '-Action',
    action,
    '-PayloadJson',
    JSON.stringify(payload),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('powershell', args, {
      cwd: MAIN_STACK_ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `desktop-control ${action} failed with exit code ${code}`,
          ),
        );
        return;
      }

      const text = stdout.trim();
      if (!text) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(
          new Error(
            `Failed to parse desktop-control output for ${action}: ${error.message}\n${text}`,
          ),
        );
      }
    });
  });
}

async function captureCodexWindowScreenshot(handle, suffix = 'sidebar') {
  const screenshotPath = path.join(
    os.tmpdir(),
    `codex-bridge-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );

  const response = await invokeDesktopControl('screenshot', {
    target: 'window',
    path: screenshotPath,
    window: { handle },
  });

  const result = response?.result || response || {};
  if (!result?.saved || !result?.path) {
    throw new Error('Failed to capture Codex window screenshot.');
  }

  return {
    path: result.path,
    rect: result.rect,
  };
}

function resolveCropRect(rect, roi = null) {
  if (!roi || !rect) {
    return null;
  }

  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  if (!width || !height) {
    return null;
  }

  const left = Math.max(0, Math.floor(width * Number(roi.x_ratio || 0)));
  const top = Math.max(0, Math.floor(height * Number(roi.y_ratio || 0)));
  const cropWidth = Math.max(1, Math.floor(width * Number(roi.w_ratio || 0)));
  const cropHeight = Math.max(1, Math.floor(height * Number(roi.h_ratio || 0)));

  return { left, top, width: cropWidth, height: cropHeight };
}

async function runOverlayOcr(imagePath, cropRect = null) {
  const args = [
    OVERLAY_OCR_FIND_SCRIPT,
    '--image',
    imagePath,
    '--pattern',
    '.+',
    '--min-score',
    '0.3',
  ];

  if (cropRect) {
    args.push(
      '--crop-left',
      String(cropRect.left),
      '--crop-top',
      String(cropRect.top),
      '--crop-width',
      String(cropRect.width),
      '--crop-height',
      String(cropRect.height),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(GAME_AUTOMATION_PYTHON, args, {
      cwd: MAIN_STACK_ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `overlay_ocr_find failed with exit code ${code}`,
          ),
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim() || '{}'));
      } catch (error) {
        reject(
          new Error(`Failed to parse overlay_ocr_find output: ${error.message}`),
        );
      }
    });
  });
}

async function readCodexWindowOcr(handle, suffix = 'sidebar', roi = null) {
  const screenshot = await captureCodexWindowScreenshot(handle, suffix);
  try {
    const cropRect = resolveCropRect(screenshot.rect, roi);
    const ocr = await runOverlayOcr(screenshot.path, cropRect);
    const allLines = Array.isArray(ocr?.all_lines) ? ocr.all_lines : [];
    return {
      screenshotPath: screenshot.path,
      rect: screenshot.rect,
      cropRect,
      allLines,
    };
  } finally {
    try {
      await fs.unlink(screenshot.path);
    } catch {
      // Ignore temp screenshot cleanup failures.
    }
  }
}

async function pressCodexKeys(handle, keys) {
  return invokeDesktopControl('press_keys', {
    window: { handle },
    keys,
  });
}

async function clickCodexWindowLine(handle, rect, line) {
  const clickPoint = buildRelativeClickPayload(line, rect);
  return clickCodexRelative(handle, clickPoint);
}

async function waitForDesktopWindow(windowSelector, timeoutMs = 10000) {
  const response = await invokeDesktopControl('wait_for', {
    kind: 'window',
    timeout_ms: timeoutMs,
    poll_ms: 250,
    window: windowSelector,
  });

  return response?.result?.window || response?.window || null;
}

async function waitForWindowGone(windowSelector, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await invokeDesktopControl('list_windows', {
      ...windowSelector,
      visible_only: true,
      include_empty_titles: true,
      limit: 20,
    });
    const windows = response?.result?.windows || response?.windows || [];
    if (windows.length === 0) {
      return true;
    }
    await sleep(250);
  }

  throw new Error('Timed out waiting for the desktop window to close.');
}

async function findCodexDesktopWindowViaProcessFallback(preferredHandle = null) {
  const script = `
    $items = Get-Process Codex -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -gt 0 -and $_.MainWindowTitle -eq 'Codex' } |
      Select-Object Id, MainWindowHandle, MainWindowTitle |
      ConvertTo-Json -Compress
    if ($null -eq $items -or $items -eq '') { '[]' } else { $items }
  `;

  const handles = await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        cwd: MAIN_STACK_ROOT,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `Codex window fallback probe failed with exit code ${code}`,
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim() || '[]');
        resolve(Array.isArray(parsed) ? parsed : parsed ? [parsed] : []);
      } catch (error) {
        reject(new Error(`Failed to parse Codex window fallback output: ${error.message}`));
      }
    });
  });

  const normalized = handles
    .map((item) => ({
      handle: Number(item?.MainWindowHandle?.value ?? item?.MainWindowHandle ?? 0),
      title: item?.MainWindowTitle || 'Codex',
      process_name: 'Codex.exe',
      visible: true,
      minimized: false,
      foreground: false,
    }))
    .filter((item) => Number.isFinite(item.handle) && item.handle > 0);

  if (typeof preferredHandle === 'number' && Number.isFinite(preferredHandle) && preferredHandle > 0) {
    const exact = normalized.find((item) => item.handle === preferredHandle);
    if (exact) {
      return exact;
    }
  }

  return normalized[0] || null;
}

async function findCodexDesktopWindow(preferredHandle = null) {
  const response = await invokeDesktopControl('list_windows', {
    process_name: 'Codex.exe',
    visible_only: true,
    include_empty_titles: true,
    limit: 20,
  });

  const windows = response?.result?.windows || response?.windows || [];
  const chooseBestWindow = (candidates) =>
    [...candidates].sort((left, right) => {
      const foregroundDelta = Number(Boolean(right.foreground)) - Number(Boolean(left.foreground));
      if (foregroundDelta !== 0) {
        return foregroundDelta;
      }

      const rightArea = Math.max(0, right?.rect?.width || 0) * Math.max(0, right?.rect?.height || 0);
      const leftArea = Math.max(0, left?.rect?.width || 0) * Math.max(0, left?.rect?.height || 0);
      return rightArea - leftArea;
    })[0] || null;

  if (typeof preferredHandle === 'number' && Number.isFinite(preferredHandle) && preferredHandle > 0) {
    const preferredWindow = windows.find(
      (window) =>
        window.handle === preferredHandle &&
        window.process_name === 'Codex.exe' &&
        window.visible &&
        !window.minimized,
    );
    if (preferredWindow) {
      return preferredWindow;
    }
  }

  const exact = chooseBestWindow(windows.filter(
    (window) =>
      window.process_name === 'Codex.exe' &&
      window.visible &&
      !window.minimized &&
      window.title === 'Codex',
  ));

  if (exact) {
    return exact;
  }

  const widgetWindow = chooseBestWindow(
    windows.filter(
      (window) =>
        window.process_name === 'Codex.exe' &&
        window.visible &&
        !window.minimized &&
        window.class_name === 'Chrome_WidgetWin_1',
    )
  );

  if (widgetWindow) {
    return widgetWindow;
  }

  return findCodexDesktopWindowViaProcessFallback(preferredHandle);
}

async function focusCodexDesktopWindow(handle) {
  const response = await invokeDesktopControl('focus_window', { handle });
  const foregroundMatched =
    response?.result?.foregroundMatched ??
    response?.foregroundMatched ??
    response?.result?.foreground_matched ??
    response?.foreground_matched ??
    false;

  if (!foregroundMatched) {
    await sleep(250);
    await invokeDesktopControl('focus_window', { handle });
    await sleep(150);
  }
}

async function clickCodexRelative(handle, point) {
  return invokeDesktopControl('mouse_click_relative', {
    window: { handle },
    activate_window: true,
    use_client_rect: true,
    x_ratio: point.x_ratio,
    y_ratio: point.y_ratio,
  });
}

async function typeIntoCodexComposer(handle, text) {
  return invokeDesktopControl('type_text', {
    window: { handle },
    text,
    via_clipboard: true,
    select_all: true,
    clear_first: true,
    verify_via_copy: true,
    restore_clipboard: true,
    max_attempts: 4,
    settle_ms: 160,
  });
}

async function typeIntoDesktopControl(windowHandle, control, text) {
  return invokeDesktopControl('type_text', {
    window: { handle: windowHandle },
    control,
    text,
    via_clipboard: true,
    select_all: true,
    restore_clipboard: true,
  });
}

async function clickDesktopControl(windowHandle, control) {
  return invokeDesktopControl('click_control', {
    window: { handle: windowHandle },
    control,
  });
}

async function invokeDesktopStableInput(text, options = {}) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    DESKTOP_STABLE_INPUT_SCRIPT,
    '-Text',
    text,
    '-XRatio',
    String(INPUT_CLICK_POINT.x_ratio),
    '-YRatio',
    String(INPUT_CLICK_POINT.y_ratio),
    '-Submit',
  ];

  if (typeof options.handle === 'number' && Number.isFinite(options.handle) && options.handle > 0) {
    args.push('-Handle', String(options.handle));
  } else {
    args.push('-ProcessName', 'Codex.exe', '-TitleContains', 'Codex');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('powershell', args, {
      cwd: MAIN_STACK_ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `desktop-stable-input failed with exit code ${code}`,
          ),
        );
        return;
      }

      const textOutput = stdout.trim();
      if (!textOutput) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(textOutput));
      } catch (error) {
        reject(
          new Error(
            `Failed to parse desktop-stable-input output: ${error.message}\n${textOutput}`,
          ),
        );
      }
    });
  });
}

async function clickCodexSidebarText(
  handle,
  text,
  { double = false, maxLength = 28, offsetX = 0, offsetY = 0 } = {},
) {
  const matchTexts = buildSidebarMatchTexts(text, maxLength);
  if (matchTexts.length === 0) {
    throw new Error('Cannot click an empty Codex sidebar label.');
  }

  let lastError = null;

  for (const matchText of matchTexts) {
    const codepoints = toTextCodepoints(matchText);
    if (!codepoints) {
      continue;
    }

    const args = [
      GAME_CLICK_TEXT_SCRIPT,
      '--title',
      'Codex',
      '--process',
      'Codex.exe',
      '--text-codepoints',
      codepoints,
      '--x-ratio',
      String(CODEX_SIDEBAR_TEXT_ROI.x_ratio),
      '--y-ratio',
      String(CODEX_SIDEBAR_TEXT_ROI.y_ratio),
      '--w-ratio',
      String(CODEX_SIDEBAR_TEXT_ROI.w_ratio),
      '--h-ratio',
      String(CODEX_SIDEBAR_TEXT_ROI.h_ratio),
    ];

    if (double) {
      args.push('--double');
    }

    if (offsetX) {
      args.push('--offset-x', String(offsetX));
    }

    if (offsetY) {
      args.push('--offset-y', String(offsetY));
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      return await new Promise((resolve, reject) => {
        const child = spawn(GAME_AUTOMATION_PYTHON, args, {
          cwd: MAIN_STACK_ROOT,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(
                stderr.trim() ||
                  stdout.trim() ||
                  `game_click_text failed for "${matchText}" with exit code ${code}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(stdout.trim() || '{}'));
          } catch (error) {
            reject(
              new Error(
                `Failed to parse game_click_text output for "${matchText}": ${error.message}`,
              ),
            );
          }
        });
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Failed to click Codex sidebar label for "${text}".`);
}

async function isCodexSidebarTextVisible(handle, text, { maxLength = 28 } = {}) {
  const matchTexts = buildSidebarMatchTexts(text, maxLength);
  if (matchTexts.length === 0) {
    return false;
  }

  for (const matchText of matchTexts) {
    const args = [
      GAME_SIGNAL_PROBE_SCRIPT,
      '--title',
      'Codex',
      '--process',
      'Codex.exe',
      '--seconds',
      '0.12',
      '--decision-hz',
      '12',
      '--capture-fps',
      '30',
      '--no-prepare-window',
      '--text-roi',
      String(CODEX_SIDEBAR_TEXT_ROI.x_ratio),
      String(CODEX_SIDEBAR_TEXT_ROI.y_ratio),
      String(CODEX_SIDEBAR_TEXT_ROI.w_ratio),
      String(CODEX_SIDEBAR_TEXT_ROI.h_ratio),
      '--text-contains',
      matchText,
      '--text-every',
      '1',
    ];

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await new Promise((resolve, reject) => {
        const child = spawn(GAME_AUTOMATION_PYTHON, args, {
          cwd: MAIN_STACK_ROOT,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(
                stderr.trim() ||
                  stdout.trim() ||
                  `game_signal_probe failed for "${matchText}" with exit code ${code}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(stdout.trim() || '{}'));
          } catch (error) {
            reject(
              new Error(
                `Failed to parse game_signal_probe output for "${matchText}": ${error.message}`,
              ),
            );
          }
        });
      });

      if ((result?.text_hits ?? 0) > 0) {
        return true;
      }
    } catch {
      // Ignore a single OCR probe failure and continue with the next candidate.
    }
  }

  return false;
}

async function waitForCodexSidebarTextVisible(
  handle,
  text,
  { maxLength = 28, timeoutMs = 1200, pollMs = 120 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const visible = await isCodexSidebarTextVisible(handle, text, { maxLength });
    if (visible) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }
  return false;
}

function findVisibleProjectRows(lines, projectDescriptors) {
  const rows = [];

  for (const descriptor of projectDescriptors) {
    const labelCandidates = buildOcrCandidates(descriptor.displayName, 18, 8);
    const match = findBestLineMatch(lines, labelCandidates, (line) => {
      const left = Number(line?.bounds?.left ?? Infinity);
      return Number.isFinite(left) && left <= CODEX_PROJECT_ROW_MAX_LEFT;
    });

    if (!match) {
      continue;
    }

    rows.push({
      projectPath: descriptor.path,
      displayName: descriptor.displayName,
      line: match.line,
      score: match.score,
    });
  }

  rows.sort((a, b) => Number(a.line.bounds.top || 0) - Number(b.line.bounds.top || 0));
  return rows;
}

function findProjectBand(projectRows, targetProjectPath, rect) {
  const normalizedTargetPath = normalizeComparablePath(targetProjectPath);
  const targetIndex = projectRows.findIndex(
    (row) => normalizeComparablePath(row.projectPath) === normalizedTargetPath,
  );
  if (targetIndex === -1) {
    return null;
  }

  const targetRow = projectRows[targetIndex];
  const nextProject = projectRows
    .slice(targetIndex + 1)
    .find((row) => Number(row.line.bounds.top || 0) > Number(targetRow.line.bounds.bottom || 0));

  return {
    targetRow,
    bandTop: Number(targetRow.line.bounds.bottom || targetRow.line.bounds.top || 0) + 3,
    bandBottom: nextProject
      ? Math.max(Number(nextProject.line.bounds.top || 0) - 3, 0)
      : Number(rect?.height || 0),
  };
}

function findSessionRowInProjectBand(lines, sessionLabel, projectBand) {
  const matches = findSessionRowsInProjectBand(lines, sessionLabel, projectBand);
  return matches[0] || null;
}

function findSessionRowsInProjectBand(lines, sessionLabel, projectBand) {
  const sessionCandidates = buildOcrCandidates(sessionLabel, 28, 12);
  if (!projectBand || sessionCandidates.length === 0) {
    return [];
  }

  const ranked = [];

  for (const line of lines) {
    const bounds = line?.bounds || {};
    const left = Number(bounds.left ?? Infinity);
    const top = Number(bounds.top ?? -Infinity);
    const bottom = Number(bounds.bottom ?? -Infinity);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !Number.isFinite(bottom) ||
      left < CODEX_SESSION_ROW_MIN_LEFT ||
      top < projectBand.bandTop ||
      bottom > projectBand.bandBottom
    ) {
      continue;
    }

    const normalizedLine = normalizeOcrText(line.text);
    if (!normalizedLine) {
      continue;
    }

    let bestScore = 0;
    let bestCandidate = null;
    for (const candidate of sessionCandidates) {
      const score = scoreNormalizedCandidate(normalizedLine, candidate.normalized);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestScore || !bestCandidate) {
      continue;
    }

    ranked.push({
      line,
      candidate: bestCandidate,
      score: bestScore,
    });
  }

  ranked.sort((a, b) => {
    const topDelta = Number(a.line.bounds.top || 0) - Number(b.line.bounds.top || 0);
    if (topDelta !== 0) {
      return topDelta;
    }
    return b.score - a.score;
  });

  const deduped = [];
  for (const item of ranked) {
    const top = Number(item.line.bounds.top || 0);
    const left = Number(item.line.bounds.left || 0);
    if (
      deduped.some(
        (existing) =>
          Math.abs(Number(existing.line.bounds.top || 0) - top) <= 3 &&
          Math.abs(Number(existing.line.bounds.left || 0) - left) <= 6,
      )
    ) {
      continue;
    }
    deduped.push(item);
  }

  return deduped;
}

function findHeaderSessionMatch(lines, sessionLabel, rect) {
  const sessionCandidates = buildOcrCandidates(sessionLabel, 28, 12);
  const width = Number(rect?.width || 0);
  const height = Number(rect?.height || 0);
  if (!width || !height || sessionCandidates.length === 0) {
    return null;
  }

  return findBestLineMatch(lines, sessionCandidates, (line) => {
    const bounds = line?.bounds || {};
    const left = Number(bounds.left ?? Infinity);
    const top = Number(bounds.top ?? Infinity);
    return (
      Number.isFinite(left) &&
      Number.isFinite(top) &&
      left >= width * CODEX_HEADER_MIN_LEFT_RATIO &&
      top <= height * CODEX_HEADER_MAX_TOP_RATIO
    );
  });
}

async function buildSessionVerificationFingerprints(sessionId) {
  const cached = sessionFingerprintCache.get(sessionId);
  if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
    return cached.fingerprints;
  }

  const result = await getCodexSessionMessages(sessionId, 12, 0);
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const fingerprints = [];

  const pushFingerprint = (text) => {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return;
    }
    for (const candidate of buildOcrCandidates(trimmed, 40, 8)) {
      if (!fingerprints.some((existing) => existing.normalized === candidate.normalized)) {
        fingerprints.push(candidate);
      }
    }
  };

  for (const message of messages.slice().reverse()) {
    const role = message?.message?.role;
    const content = message?.message?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      continue;
    }
    pushFingerprint(content);
    if (fingerprints.length >= 8) {
      break;
    }
  }

  sessionFingerprintCache.set(sessionId, {
    updatedAt: Date.now(),
    fingerprints,
  });
  return fingerprints;
}

function findContentFingerprintMatch(lines, fingerprints, rect) {
  if (!Array.isArray(fingerprints) || fingerprints.length === 0) {
    return null;
  }

  const width = Number(rect?.width || 0);
  const height = Number(rect?.height || 0);
  if (!width || !height) {
    return null;
  }

  return findBestLineMatch(lines, fingerprints, (line) => {
    const bounds = line?.bounds || {};
    const left = Number(bounds.left ?? Infinity);
    const top = Number(bounds.top ?? Infinity);
    const bottom = Number(bounds.bottom ?? Infinity);
    return (
      Number.isFinite(left) &&
      Number.isFinite(top) &&
      Number.isFinite(bottom) &&
      left >= width * CODEX_HEADER_MIN_LEFT_RATIO &&
      top >= height * 0.12 &&
      bottom <= height * 0.82
    );
  });
}

function assessDesktopSessionSelectionFromStates(headerState, contentState, sessionLabel, fingerprints) {
  const headerMatch = findHeaderSessionMatch(
    Array.isArray(headerState?.allLines) ? headerState.allLines : [],
    sessionLabel,
    headerState?.rect,
  );
  const contentMatch = findContentFingerprintMatch(
    Array.isArray(contentState?.allLines) ? contentState.allLines : [],
    fingerprints,
    contentState?.rect,
  );
  return {
    headerMatch,
    contentMatch,
    headerState,
    contentState,
    verified: Boolean(headerMatch) && (fingerprints.length === 0 || Boolean(contentMatch)),
  };
}

async function verifyDesktopSessionSelection(handle, sessionLabel, fingerprints) {
  const headerState = await readCodexWindowOcr(handle, 'selection-header', CODEX_HEADER_ROI);
  const contentState =
    fingerprints.length > 0
      ? await readCodexWindowOcr(handle, 'selection-content', CODEX_CONTENT_ROI)
      : { rect: headerState.rect, allLines: [] };
  return assessDesktopSessionSelectionFromStates(
    headerState,
    contentState,
    sessionLabel,
    fingerprints,
  );
}

async function verifyDesktopSessionHeaderOnly(handle, sessionLabel) {
  const headerState = await readCodexWindowOcr(handle, 'selection-header-fast', CODEX_HEADER_ROI);
  const headerMatch = findHeaderSessionMatch(headerState.allLines, sessionLabel, headerState.rect);
  return {
    headerState,
    headerMatch,
    verified: Boolean(headerMatch),
  };
}

async function verifyDesktopSessionSelectionAfterSettles(
  handle,
  sessionLabel,
  fingerprints,
  settleMsList = [90, 150],
) {
  for (const settleMs of settleMsList) {
    if (settleMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(settleMs);
    }
    // eslint-disable-next-line no-await-in-loop
    let verification;
    if (fingerprints.length === 0) {
      verification = await verifyDesktopSessionSelection(handle, sessionLabel, fingerprints);
    } else {
      const fastHeader = await verifyDesktopSessionHeaderOnly(handle, sessionLabel);
      if (!fastHeader.verified) {
        verification = null;
      } else {
        verification = await verifyDesktopSessionSelection(handle, sessionLabel, fingerprints);
      }
    }
    if (verification?.verified) {
      return verification;
    }
  }

  return null;
}

function getCachedSelection(sessionId, handle, rect) {
  const cached = desktopSelectionCache.get(sessionId);
  if (!cached) {
    return null;
  }
  if (cached.windowHandle !== handle) {
    return null;
  }
  const width = Number(rect?.width || 0);
  const height = Number(rect?.height || 0);
  if (!width || !height) {
    return null;
  }
  if (Math.abs((cached.rectWidth || 0) - width) > 24 || Math.abs((cached.rectHeight || 0) - height) > 24) {
    return null;
  }
  return cached;
}

function setCachedSelection(sessionId, handle, rect, projectRow, sessionLine) {
  if (!sessionId || !rect || !sessionLine) {
    return;
  }

  desktopSelectionCache.set(sessionId, {
    windowHandle: handle,
    rectWidth: Number(rect.width || 0),
    rectHeight: Number(rect.height || 0),
    sessionPoint: buildRelativeClickPayload(sessionLine, rect),
    projectPoint: projectRow ? buildRelativeClickPayload(projectRow, rect) : null,
    updatedAt: Date.now(),
  });
}

async function ensureDesktopSessionSelected(
  projectPath,
  sessionId,
  preferredWindowHandle = null,
  selectionHints = {},
) {
  const targetThread = await getDesktopThreadById(sessionId);
  if (!targetThread) {
    throw new Error(`Requested Codex Desktop session ${sessionId} was not found.`);
  }

  const codexWindow = await findCodexDesktopWindow(preferredWindowHandle);
  if (!codexWindow?.handle) {
    throw new Error('Codex Desktop window is not visible.');
  }

  await focusCodexDesktopWindow(codexWindow.handle);

  const rawThreadPath = typeof targetThread.cwd === 'string' ? targetThread.cwd : projectPath;
  const resolvedThreadPath = rawThreadPath.startsWith('\\\\?\\')
    ? path.resolve(rawThreadPath.slice(4))
    : path.resolve(rawThreadPath);
  const sessionLabel = targetThread.displayTitle || targetThread.title || sessionId;
  const projectDisplayName =
    selectionHints.projectDisplayName ||
    selectionHints.projectName ||
    path.basename(resolvedThreadPath) ||
    resolvedThreadPath;
  const verificationFingerprints = await buildSessionVerificationFingerprints(sessionId);

  const activeHeaderVerification = await verifyDesktopSessionHeaderOnly(
    codexWindow.handle,
    sessionLabel,
  );
  if (activeHeaderVerification.verified) {
    const activeVerification =
      verificationFingerprints.length > 0
        ? await verifyDesktopSessionSelection(codexWindow.handle, sessionLabel, verificationFingerprints)
        : activeHeaderVerification;
    if (activeVerification?.verified) {
      return {
        windowHandle: codexWindow.handle,
        projectLabel: projectDisplayName,
        sessionLabel,
      };
    }
  }

  let sidebarState = await readCodexWindowOcr(codexWindow.handle, 'sidebar', CODEX_SIDEBAR_TEXT_ROI);
  const cachedSelection = getCachedSelection(sessionId, codexWindow.handle, sidebarState.rect);
  if (cachedSelection?.sessionPoint) {
    await clickCodexRelative(codexWindow.handle, cachedSelection.sessionPoint);
    let verification = await verifyDesktopSessionSelectionAfterSettles(
      codexWindow.handle,
      sessionLabel,
      verificationFingerprints,
      [40, 70],
    );
    if (!verification && cachedSelection.projectPoint) {
      await clickCodexRelative(codexWindow.handle, cachedSelection.projectPoint);
      await sleep(40);
      await clickCodexRelative(codexWindow.handle, cachedSelection.sessionPoint);
      verification = await verifyDesktopSessionSelectionAfterSettles(
        codexWindow.handle,
        sessionLabel,
        verificationFingerprints,
        [45, 80],
      );
    }
    if (verification?.verified) {
      return {
        windowHandle: codexWindow.handle,
        projectLabel: projectDisplayName,
        sessionLabel,
      };
    }
    sidebarState = await readCodexWindowOcr(codexWindow.handle, 'sidebar-fallback', CODEX_SIDEBAR_TEXT_ROI);
  }

  if (activeHeaderVerification.verified && verificationFingerprints.length === 0) {
    return {
      windowHandle: codexWindow.handle,
      projectLabel: projectDisplayName,
      sessionLabel,
    };
  }

  const projectDescriptors = await getDesktopProjectDescriptors();
  if (
    !projectDescriptors.some(
      (descriptor) =>
        normalizeComparablePath(descriptor.path) === normalizeComparablePath(resolvedThreadPath),
    )
  ) {
    projectDescriptors.push({
      path: resolvedThreadPath,
      displayName: projectDisplayName,
    });
  }

  let projectRows = findVisibleProjectRows(sidebarState.allLines, projectDescriptors);
  let projectBand = findProjectBand(projectRows, resolvedThreadPath, sidebarState.rect);

  if (!projectBand?.targetRow) {
    throw new Error(`Project "${projectDisplayName}" is not currently visible in the Codex sidebar.`);
  }

  let sessionMatches = findSessionRowsInProjectBand(
    sidebarState.allLines,
    sessionLabel,
    projectBand,
  );

  if (sessionMatches.length === 0) {
    await clickCodexWindowLine(codexWindow.handle, sidebarState.rect, projectBand.targetRow.line);
    await sleep(80);

    let expanded = false;
    for (const expandKey of ['{RIGHT}', '{ENTER}', '{SPACE}']) {
      await pressCodexKeys(codexWindow.handle, expandKey);
      await sleep(110);

      sidebarState = await readCodexWindowOcr(codexWindow.handle, 'sidebar-expand');
      projectRows = findVisibleProjectRows(sidebarState.allLines, projectDescriptors);
      projectBand = findProjectBand(projectRows, resolvedThreadPath, sidebarState.rect);
      sessionMatches = findSessionRowsInProjectBand(
        sidebarState.allLines,
        sessionLabel,
        projectBand,
      );

      if (sessionMatches.length > 0) {
        expanded = true;
        break;
      }
    }

    if (!expanded && sessionMatches.length === 0) {
      throw new Error(
        `Session "${sessionLabel}" is not visible inside project "${projectDisplayName}". Refusing to route blindly.`,
      );
    }
  }

  let verifiedSelection = null;
  for (const sessionMatch of sessionMatches) {
    await clickCodexWindowLine(codexWindow.handle, sidebarState.rect, sessionMatch.line);

    // eslint-disable-next-line no-await-in-loop
    let verification = await verifyDesktopSessionSelectionAfterSettles(
      codexWindow.handle,
      sessionLabel,
      verificationFingerprints,
      [90, 140],
    );

    if (!verification) {
      await clickCodexWindowLine(codexWindow.handle, sidebarState.rect, sessionMatch.line);
      // eslint-disable-next-line no-await-in-loop
      verification = await verifyDesktopSessionSelectionAfterSettles(
        codexWindow.handle,
        sessionLabel,
        verificationFingerprints,
        [110, 180],
      );
    }

    if (verification?.verified) {
      setCachedSelection(
        sessionId,
        codexWindow.handle,
        sidebarState.rect,
        projectBand?.targetRow?.line || null,
        sessionMatch.line,
      );
      verifiedSelection = verification;
      break;
    }
  }

  if (!verifiedSelection) {
    throw new Error(
      `Codex Desktop did not switch to the verified target session "${sessionLabel}" after testing ${sessionMatches.length} candidate rows.`,
    );
  }

  return {
    windowHandle: codexWindow.handle,
    projectLabel: projectBand.targetRow.displayName,
    sessionLabel,
  };
}

function buildBridgeProjectDescriptor(projectPath) {
  const resolvedPath = path.resolve(projectPath);
  const displayName = path.basename(resolvedPath) || resolvedPath;
  const encodedName = resolvedPath.replace(/[\\/:\s~_]/g, '-');

  return {
    name: encodedName,
    path: resolvedPath,
    displayName,
    fullPath: resolvedPath,
    isCustomName: false,
    isManuallyAdded: false,
    sessions: [],
    cursorSessions: [],
    codexSessions: [],
    geminiSessions: [],
    sessionMeta: {
      hasMore: false,
      total: 0,
    },
    taskmaster: null,
    pendingDesktopBridge: true,
  };
}

async function openDesktopProjectRoot(projectPath, options = {}) {
  const resolvedProjectPath = path.resolve(projectPath);
  const stats = await fs.stat(resolvedProjectPath);
  if (!stats.isDirectory()) {
    throw new Error(`Project path is not a directory: ${resolvedProjectPath}`);
  }

  const existingThreadIds = await getDesktopThreadIdsForProject(resolvedProjectPath);
  const codexWindow = await findCodexDesktopWindow();
  if (!codexWindow) {
    throw new Error('Codex Desktop window is not visible.');
  }

  await focusCodexDesktopWindow(codexWindow.handle);
  await pressCodexKeys(codexWindow.handle, '^o');

  const pickerWindow = await waitForDesktopWindow(
    {
      title_contains: 'Select Project Root',
      process_name: 'Codex.exe',
      class_name: '#32770',
    },
    10000,
  );

  if (!pickerWindow?.handle) {
    throw new Error('Codex Desktop project picker did not appear.');
  }

  await typeIntoDesktopControl(
    pickerWindow.handle,
    {
      automation_id: '1152',
      control_type: 'Edit',
      enabled_only: true,
      visible_only: true,
    },
    resolvedProjectPath,
  );
  await clickDesktopControl(pickerWindow.handle, {
    automation_id: '1',
    control_type: 'Button',
    enabled_only: true,
    visible_only: true,
  });
  await waitForWindowGone({
    title_contains: 'Select Project Root',
    process_name: 'Codex.exe',
    class_name: '#32770',
  });

  upsertPendingDesktopProject(resolvedProjectPath, {
    displayName: path.basename(resolvedProjectPath) || resolvedProjectPath,
  });

  if (options.createBlankThread !== false) {
    await sleep(500);
    await focusCodexDesktopWindow(codexWindow.handle);
    await pressCodexKeys(codexWindow.handle, '^n');
    await sleep(600);
    setPendingBlankThread(resolvedProjectPath, {
      knownSessionIds: existingThreadIds,
      displayName: path.basename(resolvedProjectPath) || resolvedProjectPath,
      windowHandle: codexWindow.handle,
    });
  }

  return {
    project: buildBridgeProjectDescriptor(resolvedProjectPath),
    existingThreadIds,
    blankThreadReady: options.createBlankThread !== false,
    windowHandle: codexWindow.handle,
    pendingDesktopSession: {
      projectPath: resolvedProjectPath,
      knownSessionIds: existingThreadIds,
      windowHandle: codexWindow.handle,
    },
  };
}

function tailSignature(messages) {
  return JSON.stringify(
    (messages || []).slice(-12).map((message) => ({
      type: message.type,
      timestamp: message.timestamp,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.message?.content || message.output || null,
    })),
  );
}

function recentAssistantMessages(messages, sinceEpochMs) {
  return (messages || []).filter((message) => {
    if (message.type !== 'assistant') {
      return false;
    }

    const ts = message.timestamp ? new Date(message.timestamp).getTime() : 0;
    return ts >= sinceEpochMs - 1000;
  });
}

function sendMessage(writer, data) {
  if (!writer || typeof writer.send !== 'function') {
    return;
  }
  writer.send(data);
}

async function performDesktopSend(command, options = {}) {
  const window = await findCodexDesktopWindow(options.preferredWindowHandle);
  if (!window) {
    throw new Error('Codex Desktop window is not visible.');
  }

  await focusCodexDesktopWindow(window.handle);

  const typed = await invokeDesktopStableInput(command, { handle: window.handle });
  const verified = typed?.result?.verified ?? typed?.verified ?? false;
  if (!verified) {
    throw new Error('Failed to verify desktop composer input.');
  }
  return { window };
}

async function clickDesktopStop(sessionId) {
  const state = activeDesktopBridgeSessions.get(sessionId);
  const handle = state?.windowHandle;
  if (!handle) {
    return false;
  }

  try {
    await focusCodexDesktopWindow(handle);
    await clickCodexRelative(handle, SUBMIT_CLICK_POINT);
    return true;
  } catch {
    return false;
  }
}

async function monitorDesktopBoundSession(sessionId, baseline, sendStartedAtMs, writer) {
  const state = activeDesktopBridgeSessions.get(sessionId);
  if (!state) {
    throw new Error('Desktop bridge session state disappeared before monitoring started.');
  }

  await waitForSessionStabilization(sessionId, sendStartedAtMs, writer);
  state.status = 'completed';
}

export function isCodexDesktopBridgeEnabled() {
  return CODEX_DESKTOP_BRIDGE_MODE;
}

export async function getCodexDesktopBridgeStatus(projectPath) {
  const currentThread = await getCurrentDesktopThread(projectPath);
  const window = await findCodexDesktopWindow();
  const pendingBlankThread = getPendingBlankThread(projectPath);

  return {
    enabled: CODEX_DESKTOP_BRIDGE_MODE,
    currentThread,
    window,
    pendingBlankThread,
  };
}

export async function createCodexDesktopProject(projectPath) {
  const result = await openDesktopProjectRoot(projectPath, { createBlankThread: true });
  return {
    success: true,
    project: {
      ...result.project,
      pendingDesktopSession: result.pendingDesktopSession,
    },
    blankThreadReady: result.blankThreadReady,
    pendingDesktopSession: result.pendingDesktopSession,
  };
}

export async function createCodexDesktopSession(projectPath) {
  const result = await openDesktopProjectRoot(projectPath, { createBlankThread: true });
  return {
    success: true,
    project: {
      ...result.project,
      pendingDesktopSession: result.pendingDesktopSession,
    },
    blankThreadReady: result.blankThreadReady,
    pendingDesktopSession: result.pendingDesktopSession,
  };
}

export async function queryCodexDesktopBridge(command, options = {}, writer) {
  const projectPath = options.projectPath || options.cwd || process.cwd();
  const requestedSessionId = options.sessionId || null;
  const explicitPendingBlankThread =
    !requestedSessionId &&
    options.desktopPendingBlankThread &&
    typeof options.desktopPendingBlankThread === 'object'
      ? {
          projectPath:
            options.desktopPendingBlankThread.projectPath || projectPath,
          knownSessionIds: Array.isArray(options.desktopPendingBlankThread.knownSessionIds)
            ? options.desktopPendingBlankThread.knownSessionIds
            : [],
          windowHandle:
            typeof options.desktopPendingBlankThread.windowHandle === 'number' &&
            Number.isFinite(options.desktopPendingBlankThread.windowHandle)
              ? options.desktopPendingBlankThread.windowHandle
              : null,
        }
      : null;
  const pendingBlankThread = !requestedSessionId
    ? explicitPendingBlankThread || getPendingBlankThread(projectPath)
    : null;
  const usePendingBlankThread = Boolean(pendingBlankThread && !requestedSessionId);

  const currentThread = await getCurrentDesktopThread(projectPath);
  if (!currentThread && !pendingBlankThread) {
    throw new Error('No active Codex Desktop thread was found for the requested project.');
  }

  const targetSessionId = usePendingBlankThread ? null : requestedSessionId || currentThread?.id || null;

  const baseline = targetSessionId
    ? await getCodexSessionMessages(targetSessionId, 60, 0)
    : { messages: [], total: 0 };
  const bridgeState = {
    status: 'running',
    startedAt: new Date().toISOString(),
    currentThread: currentThread || {
      id: null,
      cwd: projectPath,
      displayTitle: path.basename(projectPath) || 'Codex Session',
    },
    windowHandle: null,
  };

  if (targetSessionId) {
    activeDesktopBridgeSessions.set(targetSessionId, bridgeState);
  }

  try {
    if (targetSessionId) {
      const selectedDesktopTarget = await ensureDesktopSessionSelected(
        projectPath,
        targetSessionId,
        pendingBlankThread?.windowHandle || null,
        {
          projectName:
            typeof options.projectName === 'string' ? options.projectName : '',
          projectDisplayName:
            typeof options.projectDisplayName === 'string' ? options.projectDisplayName : '',
        },
      );
      bridgeState.windowHandle = selectedDesktopTarget.windowHandle;
      sendMessage(writer, {
        type: 'session-created',
        sessionId: targetSessionId,
        provider: 'codex',
      });
    }

    let effectiveKnownSessionIds = Array.isArray(pendingBlankThread?.knownSessionIds)
      ? pendingBlankThread.knownSessionIds
      : [];

    if (usePendingBlankThread) {
      const freshKnownSessionIds = await getDesktopThreadIdsForProject(projectPath);
      effectiveKnownSessionIds = Array.from(
        new Set([...effectiveKnownSessionIds, ...freshKnownSessionIds]),
      );
    }

    const sendStartedAtMs = Date.now();
    const sendResult = await performDesktopSend(command, {
      preferredWindowHandle: pendingBlankThread?.windowHandle || null,
    });
    bridgeState.windowHandle = sendResult.window.handle;

    if (targetSessionId) {
      await monitorDesktopBoundSession(targetSessionId, baseline, sendStartedAtMs, writer);
      return;
    }

    if (!pendingBlankThread) {
      throw new Error('Desktop bridge was asked to create a new session, but no pending blank thread was prepared.');
    }

    const actualThread = await waitForNewDesktopThread(
      projectPath,
      effectiveKnownSessionIds,
      sendStartedAtMs,
    );

    activeDesktopBridgeSessions.set(actualThread.id, {
      ...bridgeState,
      currentThread: actualThread,
    });

    clearPendingBlankThread(projectPath);
    clearPendingDesktopProject(projectPath);

    sendMessage(writer, {
      type: 'session-created',
      sessionId: actualThread.id,
      provider: 'codex',
    });

    await monitorDesktopBoundSession(actualThread.id, { messages: [], total: 0 }, sendStartedAtMs, writer);
  } catch (error) {
    bridgeState.status = bridgeState.status === 'aborted' ? 'aborted' : 'failed';
    throw error;
  }
}

export function abortCodexDesktopBridgeSession(sessionId) {
  const state = activeDesktopBridgeSessions.get(sessionId);
  if (!state || state.status !== 'running') {
    return false;
  }

  state.status = 'aborted';
  clickDesktopStop(sessionId).catch(() => undefined);
  return true;
}

export function isCodexDesktopBridgeSessionActive(sessionId) {
  const state = activeDesktopBridgeSessions.get(sessionId);
  return state?.status === 'running';
}

export function getActiveCodexDesktopBridgeSessions() {
  const sessions = [];
  for (const [id, session] of activeDesktopBridgeSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt,
        title: session.currentThread?.displayTitle || 'Codex Desktop Session',
      });
    }
  }
  return sessions;
}
