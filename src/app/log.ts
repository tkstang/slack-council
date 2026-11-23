import { LogLevel, type Logger } from '@slack/bolt';

export type LogEntry = Readonly<Record<string, string | number | boolean>>;
export type Log = (entry: LogEntry) => void;

/** One JSON line per entry on stderr. Callers pass codes and ids, never text or tokens. */
export function createStderrLog(
  write: (line: string) => void = (line) => process.stderr.write(line),
): Log {
  return (entry) => {
    write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
  };
}

const TOKEN = /\bx(?:ox[a-z]|app)-[A-Za-z0-9-]+/gu;

function describe(value: unknown): string {
  if (typeof value === 'string') {
    return value.replaceAll(TOKEN, '[redacted]').slice(0, 300);
  }
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    // Client errors can embed the request and its auth header: keep the name and code only.
    return typeof code === 'string' ? `${value.name}:${code}` : value.name;
  }
  return typeof value;
}

/** A Bolt logger that drops debug/info and writes warnings and errors as sanitised JSON. */
export function createBoltLogger(log: Log): Logger {
  let level = LogLevel.WARN;
  const emit = (entryLevel: 'warn' | 'error', parts: unknown[]) =>
    log({
      level: entryLevel,
      source: 'bolt',
      message: parts.map(describe).join(' '),
    });
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (...parts: unknown[]) => {
      if (level !== LogLevel.ERROR) emit('warn', parts);
    },
    error: (...parts: unknown[]) => emit('error', parts),
    setLevel: (next) => {
      level = next;
    },
    getLevel: () => level,
    setName: () => undefined,
  };
}
