import { MailMessage } from '../domain/mail-sender';
import { OutboxStore } from '../domain/outbox';
import { OutboxWorker } from './outbox-worker';

/** How long a request waits for the first send attempt before it returns (serverless time budget). */
export const IMMEDIATE_SEND_BUDGET_MS = 8_000;

/**
 * The one way features queue mail (spec 10.3). The message is always written to the outbox first.
 * In sweep mode (serverless host) one send attempt follows at once, inside the request; anything
 * still pending is retried by the scheduled sweep. A failed immediate attempt never fails the caller.
 */
export class OutboxService {
  constructor(
    private readonly store: OutboxStore,
    private readonly worker: Pick<OutboxWorker, 'tick'>,
    private readonly mode: 'loop' | 'sweep',
    private readonly budgetMs: number = IMMEDIATE_SEND_BUDGET_MS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async queue(message: MailMessage): Promise<string> {
    const id = await this.store.enqueue(message, this.clock());
    if (this.mode === 'sweep') await this.attemptNow();
    return id;
  }

  private async attemptNow(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.budgetMs);
    });
    try {
      await Promise.race([this.worker.tick().then(() => undefined), limit]);
    } catch {
      // The row stays pending and the sweep retries it.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
