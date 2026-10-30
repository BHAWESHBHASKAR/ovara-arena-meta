// The live feed: one sequence for the whole deployment, read with a long poll.

export type FeedKind = 'task' | 'thought' | 'call' | 'decision' | 'result' | 'untrusted' | 'done';

export interface FeedItem {
  seq: number;
  at: string;
  task_id: string;
  kind: FeedKind;
  [field: string]: unknown;
}

export class Feed {
  private items: FeedItem[] = [];
  private seq = 0;
  private waiters = new Set<() => void>();
  private listeners = new Set<(item: FeedItem) => void>();

  constructor(private readonly keep = 5000, private readonly now: () => Date = () => new Date()) {}

  push(taskId: string, kind: FeedKind, fields: Record<string, unknown> = {}): FeedItem {
    const item: FeedItem = { ...fields, seq: ++this.seq, at: this.now().toISOString(), task_id: taskId, kind };
    this.items.push(item);
    if (this.items.length > this.keep) this.items.splice(0, this.items.length - this.keep);
    for (const l of this.listeners) l(item);
    const ws = [...this.waiters];
    this.waiters.clear();
    for (const w of ws) w();
    return item;
  }

  onItem(fn: (item: FeedItem) => void): void {
    this.listeners.add(fn);
  }

  get lastSeq(): number {
    return this.seq;
  }

  since(seq: number, taskId?: string): FeedItem[] {
    // items are in seq order, so a binary search would do; the list is small enough to scan
    return this.items.filter((i) => i.seq > seq && (!taskId || i.task_id === taskId));
  }

  forTask(taskId: string): FeedItem[] {
    return this.items.filter((i) => i.task_id === taskId);
  }

  lastOf(taskId: string, kind: FeedKind): FeedItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.task_id === taskId && it.kind === kind) return it;
    }
    return undefined;
  }

  // Resolves with the items after `seq` as soon as there are any, or with []
  // after timeoutMs. An aborted signal resolves at once with [].
  wait(seq: number, timeoutMs: number, signal?: AbortSignal, taskId?: string): Promise<FeedItem[]> {
    const now = this.since(seq, taskId);
    if (now.length || signal?.aborted) return Promise.resolve(now);
    return new Promise((resolveWait) => {
      let timer: NodeJS.Timeout;
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
        signal?.removeEventListener('abort', finish);
        resolveWait(this.since(seq, taskId));
      };
      const check = () => {
        if (this.since(seq, taskId).length) finish();
        else this.waiters.add(check);
      };
      timer = setTimeout(finish, timeoutMs);
      signal?.addEventListener('abort', finish, { once: true });
      this.waiters.add(check);
    });
  }
}
