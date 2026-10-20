/**
 * Walking back through what you've sent, with the up and down arrows.
 *
 * The first press stashes whatever is half-typed, so pressing down past the
 * newest entry gives it back rather than losing it — the part people miss in
 * naive versions of this, and the reason it's worth a class.
 */
export class PromptHistory {
  private index: number;
  private stash = "";

  constructor(private entries: string[]) {
    this.index = entries.length;
  }

  /**
   * Take a fresh list of entries. A list with the same contents is ignored —
   * the chat is re-saved and re-fetched while you browse, and each of those
   * hands over a new array that must not make you lose your place.
   * Returns whether anything changed.
   */
  sync(next: string[]): boolean {
    if (next.length === this.entries.length && next.every((e, i) => e === this.entries[i])) return false;
    this.entries = next;
    this.index = next.length;
    this.stash = "";
    return true;
  }

  /** Whether the text on screen is a recalled entry rather than typed. */
  get browsing(): boolean {
    return this.index < this.entries.length;
  }

  /** The next older entry, or null if there isn't one. `current` is saved on the first press. */
  up(current: string): string | null {
    if (this.entries.length === 0 || this.index === 0) return null;
    if (this.index === this.entries.length) this.stash = current;
    this.index--;
    return this.entries[this.index];
  }

  /** The next newer entry — at the end, what was being typed — or null if not browsing. */
  down(): string | null {
    if (!this.browsing) return null;
    this.index++;
    return this.index === this.entries.length ? this.stash : this.entries[this.index];
  }

  reset(): void {
    this.index = this.entries.length;
    this.stash = "";
  }
}
