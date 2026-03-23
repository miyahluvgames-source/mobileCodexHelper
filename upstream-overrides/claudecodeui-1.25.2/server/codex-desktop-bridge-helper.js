import {
  createCodexDesktopProject,
  createCodexDesktopSession,
  queryCodexDesktopBridge,
} from './codex-desktop-bridge.js';

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

async function main() {
  const action = process.argv[2];
  const payload = await readPayload();

  try {
    switch (action) {
      case 'create-session': {
        const result = await createCodexDesktopSession(payload.path);
        emit({ type: 'result', result });
        return;
      }

      case 'open-project': {
        const result = await createCodexDesktopProject(payload.path);
        emit({ type: 'result', result });
        return;
      }

      case 'send-command': {
        const writer = {
          send(data) {
            emit({ type: 'event', data });
          },
        };

        await queryCodexDesktopBridge(payload.command, payload.options || {}, writer);
        emit({ type: 'done' });
        return;
      }

      default:
        throw new Error(`Unsupported desktop bridge helper action: ${action || '<empty>'}`);
    }
  } catch (error) {
    emit({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

main();
