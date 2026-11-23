import { appendFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const path = process.env.COUNCIL_NOTES_FILE;
if (!path) process.exit(1);

const tools = [
  {
    name: 'list_notes',
    description: 'Read the notes file.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'append_note',
    description: 'Append one line to the notes file.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 2_000 } },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

function result(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool({ name, arguments: args } = {}) {
  if (name === 'list_notes') {
    try {
      return result(await readFile(path, 'utf8'));
    } catch (error) {
      return error.code === 'ENOENT'
        ? result('')
        : result('Could not read the notes file.', true);
    }
  }
  if (name === 'append_note') {
    const text = args?.text?.trim?.();
    if (
      typeof text !== 'string' ||
      !text ||
      text.length > 2_000 ||
      /[\r\n]/u.test(text)
    ) {
      return result(
        'Provide one line of text with at most 2,000 characters.',
        true,
      );
    }
    try {
      await appendFile(path, `${text}\n`, { encoding: 'utf8', mode: 0o600 });
      return result('Note appended.');
    } catch {
      return result('Could not write the notes file.', true);
    }
  }
  return result('Unknown tool.', true);
}

async function handle({ id, method, params }) {
  if (id === undefined) return;
  const envelope = { jsonrpc: '2.0', id };
  switch (method) {
    case 'initialize':
      return {
        ...envelope,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'council-notes-example', version: '1.0.0' },
        },
      };
    case 'tools/list':
      return { ...envelope, result: { tools } };
    case 'tools/call':
      return { ...envelope, result: await callTool(params) };
    default:
      return {
        ...envelope,
        error: { code: -32601, message: 'Method not found' },
      };
  }
}

for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  let response;
  try {
    response = await handle(JSON.parse(line));
  } catch {
    response = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Invalid request' },
    };
  }
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
