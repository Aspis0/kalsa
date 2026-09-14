/**
 * Serialises writes of one field, so the stored value ends up being the one the
 * user last saw — never an older one.
 *
 * The failure it exists for: a write of T0 is in flight, the user types T1, the
 * write lands and the screen shows T1. The store holds T0 and nothing says so.
 * Typing marks the field edited; when the write in flight finishes, the newer
 * value is written too. A store that fails is reported, not retried in a loop.
 */
export class LatestSave<T> {
  private pending = false;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    private readonly read: () => T,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** The field changed: whatever is being written must catch up when it lands. */
  markEdited(): void {
    this.pending = true;
  }

  /** Writes now; resolves when the store matches the field, or the write failed. */
  save(): Promise<void> {
    this.pending = true;
    if (!this.inFlight) {
      this.inFlight = this.drain().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      try {
        await this.write(this.read());
      } catch (error) {
        this.pending = false;
        this.onError(error);
        return;
      }
    }
  }
}
