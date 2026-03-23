/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  abortCodexDesktopBridgeSession,
  getActiveCodexDesktopBridgeSessions,
  isCodexDesktopBridgeEnabled,
  isCodexDesktopBridgeSessionActive,
  queryCodexDesktopBridge,
} from './codex-desktop-bridge.js';

// Track active sessions
const activeCodexSessions = new Map();
const CODEX_ONLY_HARDENED_MODE = process.env.CODEX_ONLY_HARDENED_MODE !== 'false';
const CODEX_SESSION_INDEX_PATH = path.join(os.homedir(), '.codex', 'session_index.jsonl');

const NON_ASCII_PATH_PATTERN = /[^\u0000-\u007F]/;

function containsNonAscii(value) {
  return typeof value === 'string' && NON_ASCII_PATH_PATTERN.test(value);
}

function summarizeThreadName(command, fallback = 'Codex Session') {
  if (typeof command !== 'string') {
    return fallback;
  }

  const candidate = command
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => {
      const normalized = line.toLowerCase();
      return normalized !== 'uploaded files:' &&
        normalized !== 'please inspect these uploaded files:' &&
        !normalized.startsWith('- ');
    });

  if (!candidate) {
    return fallback;
  }

  return candidate.length > 80 ? `${candidate.slice(0, 77)}...` : candidate;
}

async function loadLatestSessionIndexTitle(sessionId) {
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
        if (entry.id !== sessionId || typeof entry.thread_name !== 'string' || !entry.thread_name.trim()) {
          continue;
        }

        const updatedAt = entry.updated_at ? new Date(entry.updated_at).getTime() : 0;
        if (updatedAt >= latestUpdatedAt) {
          latestUpdatedAt = updatedAt;
          latestTitle = entry.thread_name.trim();
        }
      } catch {
        // Skip malformed rows.
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

async function appendSessionIndexEntry(sessionId, threadName) {
  if (!sessionId) {
    return;
  }

  const resolvedThreadName = threadName?.trim() || await loadLatestSessionIndexTitle(sessionId) || 'Codex Session';
  await fs.mkdir(path.dirname(CODEX_SESSION_INDEX_PATH), { recursive: true });
  await fs.appendFile(
    CODEX_SESSION_INDEX_PATH,
    `${JSON.stringify({
      id: sessionId,
      thread_name: resolvedThreadName,
      updated_at: new Date().toISOString(),
    })}\n`,
    'utf8',
  );
}

async function ensureAsciiWorkingDirectory(projectPath) {
  if (process.platform !== 'win32' || !containsNonAscii(projectPath)) {
    return projectPath;
  }

  const resolvedProjectPath = path.resolve(projectPath);
  const projectDriveRoot = path.parse(resolvedProjectPath).root || 'C:\\';
  const aliasRoot = path.join(projectDriveRoot, 'codex_project_aliases');
  const aliasName = crypto.createHash('sha1').update(resolvedProjectPath.toLowerCase()).digest('hex');
  const aliasPath = path.join(aliasRoot, aliasName);

  await fs.mkdir(aliasRoot, { recursive: true });

  try {
    const aliasStats = await fs.lstat(aliasPath);
    if (aliasStats.isDirectory() || aliasStats.isSymbolicLink()) {
      return aliasPath;
    }

    if (!aliasStats.isSymbolicLink() && !aliasStats.isDirectory()) {
      await fs.rm(aliasPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.symlink(resolvedProjectPath, aliasPath, 'junction');
  return aliasPath;
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.thread_id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: CODEX_ONLY_HARDENED_MODE ? 'never' : 'untrusted'
      };
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
async function queryCodexViaSdk(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model,
    permissionMode = 'default',
    sessionTitle,
  } = options;

  const requestedWorkingDirectory = cwd || projectPath || process.cwd();
  const workingDirectory = await ensureAsciiWorkingDirectory(requestedWorkingDirectory);
  if (workingDirectory !== requestedWorkingDirectory) {
    console.log('[Codex] Using ASCII working directory alias:', workingDirectory, 'for', requestedWorkingDirectory);
  }
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let currentSessionId = sessionId || null;
  let sessionMapKey = sessionId || `codex-pending-${Date.now()}`;
  const abortController = new AbortController();
  const fallbackThreadTitle = summarizeThreadName(command, sessionTitle || 'Codex Session');

  try {
    // Initialize Codex SDK
    codex = new Codex();

    // Thread options with sandbox and approval settings
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model
    };

    // Start or resume thread
    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    // Get the thread ID
    const resolvedThreadTitle = (sessionId && await loadLatestSessionIndexTitle(sessionId)) || sessionTitle || fallbackThreadTitle;

    // Track the session
    activeCodexSessions.set(sessionMapKey, {
      thread,
      codex,
      status: 'running',
      abortController,
      startedAt: new Date().toISOString(),
      title: resolvedThreadTitle,
    });

    if (currentSessionId) {
      await appendSessionIndexEntry(currentSessionId, resolvedThreadTitle);
      sendMessage(ws, {
        type: 'session-created',
        sessionId: currentSessionId,
        provider: 'codex'
      });
    }

    // Execute with streaming
    const streamedTurn = await thread.runStreamed(command, {
      signal: abortController.signal
    });

    for await (const event of streamedTurn.events) {
      if (event.type === 'thread.started' && event.thread_id) {
        const actualSessionId = event.thread_id;
        if (!currentSessionId || currentSessionId !== actualSessionId) {
          const session = activeCodexSessions.get(sessionMapKey);
          if (session) {
            activeCodexSessions.delete(sessionMapKey);
            sessionMapKey = actualSessionId;
            activeCodexSessions.set(sessionMapKey, session);
          }

          currentSessionId = actualSessionId;
          await appendSessionIndexEntry(currentSessionId, resolvedThreadTitle);
          sendMessage(ws, {
            type: 'session-created',
            sessionId: currentSessionId,
            provider: 'codex'
          });
        }
      }

      // Check if session was aborted
      const session = activeCodexSessions.get(sessionMapKey);
      if (!session || session.status === 'aborted') {
        break;
      }

      if (event.type === 'item.started' || event.type === 'item.updated') {
        continue;
      }

      const transformed = transformCodexEvent(event);

      sendMessage(ws, {
        type: 'codex-response',
        data: transformed,
        sessionId: currentSessionId
      });

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed' && event.usage) {
        const totalTokens = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0);
        sendMessage(ws, {
          type: 'token-budget',
          data: {
            used: totalTokens,
            total: 200000 // Default context window for Codex models
          },
          sessionId: currentSessionId
        });
      }
    }

    // Send completion event
    await appendSessionIndexEntry(currentSessionId, resolvedThreadTitle);
    sendMessage(ws, {
      type: 'codex-complete',
      sessionId: currentSessionId,
      actualSessionId: thread.id
    });

  } catch (error) {
    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);
      sendMessage(ws, {
        type: 'codex-error',
        error: error.message,
        sessionId: currentSessionId
      });
    }

  } finally {
    // Update session status
    if (currentSessionId) {
      const session = activeCodexSessions.get(sessionMapKey);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

export async function queryCodex(command, options = {}, ws) {
  if (isCodexDesktopBridgeEnabled()) {
    return queryCodexDesktopBridge(command, options, ws);
  }

  return queryCodexViaSdk(command, options, ws);
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  if (abortCodexDesktopBridgeSession(sessionId)) {
    return true;
  }

  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  if (isCodexDesktopBridgeSessionActive(sessionId)) {
    return true;
  }

  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [...getActiveCodexDesktopBridgeSessions()];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
