/** Short-lived exclusive file leases. Time is injected so tests are deterministic. */
export class LeaseTable {
  private leases = new Map<string, { owner: string; expires: number }>()
  constructor(private ttlMs = 10 * 60_000, private now: () => number = Date.now) {}

  /** Acquire or refresh. Returns the current owner if someone else holds a live lease. */
  acquire(path: string, owner: string): { ok: true } | { ok: false; heldBy: string } {
    const cur = this.leases.get(path)
    if (cur && cur.owner !== owner && cur.expires > this.now()) return { ok: false, heldBy: cur.owner }
    this.leases.set(path, { owner, expires: this.now() + this.ttlMs })
    return { ok: true }
  }
  releaseAll(owner: string): number {
    let n = 0
    for (const [p, l] of this.leases) if (l.owner === owner) { this.leases.delete(p); n++ }
    return n
  }
  heldBy(path: string): string | undefined { const l = this.leases.get(path); return l && l.expires > this.now() ? l.owner : undefined }
}
