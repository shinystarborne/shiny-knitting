/**
 * For the checks: the parts of the stub's store a suite changes, copied when
 * it starts and put back when it ends (in its `finally`), so the suites after
 * it find the store as the seed left it rather than as this one did.
 *
 *   const restore = keep(["projects", "projectYarns"]);
 *   try { ... } finally { restore(); }
 */
export function keep(keys: string[]): () => void {
  const store = (window as unknown as { __store: Record<string, unknown> }).__store;
  const seed = structuredClone(Object.fromEntries(keys.map((k) => [k, store[k]])));
  return () => {
    for (const k of keys) store[k] = seed[k];
  };
}
