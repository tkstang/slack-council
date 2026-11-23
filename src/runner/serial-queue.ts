export function createSerialQueue() {
  let tail = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const before = tail;
      const next = (async () => {
        await before;
        return operation();
      })();
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    drain: () => tail,
  };
}
