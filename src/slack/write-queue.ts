export interface WriteQueueOptions {
  /** Minimum gap between the end of one write and the start of the next. */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Serialises writes per channel and spaces them at least `intervalMs` apart. */
export function createChannelWriteQueue({
  intervalMs = 1_000,
  now = Date.now,
  sleep = realSleep,
}: WriteQueueOptions = {}) {
  const tails = new Map<string, Promise<void>>();
  const lastWrite = new Map<string, number>();

  return {
    run<T>(channel: string, write: () => Promise<T>): Promise<T> {
      const before = tails.get(channel) ?? Promise.resolve();
      const next = before.then(async () => {
        const previous = lastWrite.get(channel);
        const wait = previous === undefined ? 0 : previous + intervalMs - now();
        if (wait > 0) await sleep(wait);
        try {
          return await write();
        } finally {
          lastWrite.set(channel, now());
        }
      });
      const tail = next.then(
        () => undefined,
        () => undefined,
      );
      tails.set(channel, tail);
      void tail.then(() => {
        if (tails.get(channel) === tail) tails.delete(channel);
      });
      return next;
    },
  };
}
