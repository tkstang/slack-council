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

const ID = /^[\w.-]{1,80}$/u;

/** `Name:code` for each error argument. Free text is dropped: server diagnostics can echo request content. */
function errorIds(parts: readonly unknown[]): string {
  return parts
    .filter((part): part is Error => part instanceof Error)
    .map((error) => {
      const name = ID.test(error.name) ? error.name : 'Error';
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' && ID.test(code)
        ? `${name}:${code}`
        : name;
    })
    .join(',');
}

/** A Bolt logger that drops debug/info and logs warnings and errors as fixed identifiers. */
export function createBoltLogger(log: Log): Logger {
  let level = LogLevel.WARN;
  const emit = (entryLevel: 'warn' | 'error', parts: unknown[]) => {
    const errors = errorIds(parts);
    log({
      level: entryLevel,
      source: 'bolt',
      code: `sdk_${entryLevel}`,
      ...(errors === '' ? {} : { error: errors }),
    });
  };
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
