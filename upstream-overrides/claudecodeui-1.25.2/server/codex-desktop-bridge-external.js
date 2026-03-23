import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  clearPendingBlankThread,
  clearPendingDesktopProject,
  setPendingBlankThread,
  upsertPendingDesktopProject,
} from './codex-desktop-bridge-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HELPER_PATH = path.join(__dirname, 'codex-desktop-bridge-helper.js');

function spawnHelper(action, payload, { onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER_PATH, action], {
      cwd: path.resolve(__dirname, '..'),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let resultPayload;

    const settle = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    const processLine = (line) => {
      if (!line.trim()) {
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        stderr = `${stderr}\nFailed to parse desktop bridge helper output: ${error.message}\n${line}`.trim();
        return;
      }

      if (parsed.type === 'event') {
        onEvent?.(parsed.data);
        return;
      }

      if (parsed.type === 'result') {
        resultPayload = parsed.result;
        return;
      }

      if (parsed.type === 'error') {
        settle(() => reject(new Error(parsed.error || 'Desktop bridge helper failed.')));
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        processLine(line);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      settle(() => reject(error));
    });

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }

      if (settled) {
        return;
      }

      if (code !== 0) {
        settle(() =>
          reject(
            new Error(
              stderr.trim() || `Desktop bridge helper ${action} failed with exit code ${code}`,
            ),
          ),
        );
        return;
      }

      settle(() => resolve(resultPayload));
    });

    child.stdin.end(JSON.stringify(payload || {}));
  });
}

function mirrorPendingDesktopState(result) {
  const pendingDesktopSession = result?.pendingDesktopSession;
  if (!pendingDesktopSession?.projectPath) {
    return;
  }

  upsertPendingDesktopProject(pendingDesktopSession.projectPath, {
    displayName: result?.project?.displayName,
  });

  setPendingBlankThread(pendingDesktopSession.projectPath, {
    knownSessionIds: pendingDesktopSession.knownSessionIds,
    displayName: result?.project?.displayName,
    windowHandle: pendingDesktopSession.windowHandle,
  });
}

export async function createDesktopSessionViaHelper(projectPath) {
  const result = await spawnHelper('create-session', { path: projectPath });
  mirrorPendingDesktopState(result);
  return result;
}

export async function openDesktopProjectViaHelper(projectPath) {
  const result = await spawnHelper('open-project', { path: projectPath });
  mirrorPendingDesktopState(result);
  return result;
}

export async function queryDesktopBridgeViaHelper(command, options = {}, writer) {
  const result = await spawnHelper(
    'send-command',
    { command, options },
    {
      onEvent: (data) => {
        if (data?.type === 'session-created' && options?.projectPath) {
          clearPendingBlankThread(options.projectPath);
          clearPendingDesktopProject(options.projectPath);
        }

        if (writer && typeof writer.send === 'function') {
          writer.send(data);
        }
      },
    },
  );

  return result;
}
