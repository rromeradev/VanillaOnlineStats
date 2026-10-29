// SPDX-License-Identifier: AGPL-3.0-only
// One visible read at a time per target; late responses never replace a new page.
export class LiveReader {
  private key: string | null = null;
  private generation = 0;
  private due = 0;
  private failures = 0;
  private pending = new Set<string>();

  reset() { this.key = null; this.generation++; this.due = 0; this.failures = 0; }

  async poll(key: string | null, read: () => Promise<any>, publish: (value: any) => void,
      failed: (error: any) => void, now = Date.now()): Promise<void> {
    if (key !== this.key) { this.key = key; this.generation++; this.due = 0; this.failures = 0; }
    if (!key || this.pending.has(key) || this.pending.size >= 4 || now < this.due) return;
    const generation = this.generation;
    this.pending.add(key); this.due = now + 1000;
    try {
      const value = await read();
      if (generation !== this.generation) return;
      this.failures = 0; this.due = Date.now() + 1000; publish(value);
    } catch (error) {
      if (generation !== this.generation) return;
      this.due = Date.now() + Math.min(30000, 1000 * 2 ** ++this.failures); failed(error);
    } finally { this.pending.delete(key); }
  }
}
