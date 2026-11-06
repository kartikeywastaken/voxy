// All sponsored writes share server signers. Serialize across owners and routes.
let tail: Promise<unknown> = Promise.resolve();
export function sponsoredWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => undefined);
  return result;
}
