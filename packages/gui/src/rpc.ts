// JSON-RPC 2.0 client for `revamp serve`: requests by id, notifications (job.progress) to listeners.

export interface Transport {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
}

export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Rpc {
  call<T>(method: string, params?: object): Promise<T>;
  /** Returns the unsubscribe function. */
  onNotification(listener: (method: string, params: unknown) => void): () => void;
}

export function rpcClient(transport: Transport): Rpc {
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(method: string, params: unknown) => void>();
  transport.onLine((line) => {
    let message: { id?: number; result?: unknown; error?: { code: number; message: string }; method?: string; params?: unknown };
    try {
      message = JSON.parse(line);
    } catch {
      return console.warn("revamp serve sent a line that isn't JSON:", line);
    }
    if (typeof message.method === "string") return listeners.forEach((l) => l(message.method!, message.params));
    const waiting = message.id === undefined ? undefined : pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id!);
    if (message.error) waiting.reject(new RpcError(message.error.code, message.error.message));
    else waiting.resolve(message.result);
  });
  return {
    call: <T>(method: string, params?: object) =>
      new Promise<T>((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params && { params }) }));
      }),
    onNotification(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
