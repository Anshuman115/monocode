import { parseQuickLaunch, type QuickLaunch } from "./quickComposer";

/** Serialize mount/focus/event deliveries and acknowledge only accepted launches.
 * Receipts survive effect remounts so a failed ACK never starts a second session. */
export function launchReceiver(options: {
  take: () => Promise<unknown>;
  accept: (launch: QuickLaunch, id: string) => Promise<void>;
  ack: (id: string) => Promise<void>;
  disposed: () => boolean;
  accepted: Set<string>;
  accepting: Map<string, Promise<void>>;
}) {
  let running: Promise<void> | undefined;
  let requested = false;
  return function receive(): Promise<void> {
    requested = true;
    if (running) return running;
    running = (async () => {
      do {
        requested = false;
        while (!options.disposed()) {
          const value = await options.take();
          if (value == null || options.disposed()) break;
          const envelope = value as { id?: unknown; request?: unknown };
          const launch = parseQuickLaunch(envelope.request);
          if (typeof envelope.id !== "string" || !envelope.id || !launch)
            throw new Error(
              "Invalid queued session; it has been retained for retry.",
            );
          if (!options.accepted.has(envelope.id)) {
            const id = envelope.id;
            let acceptance = options.accepting.get(id);
            if (!acceptance) {
              acceptance = options
                .accept(launch, id)
                .then(() => {
                  options.accepted.add(id);
                })
                .finally(() => {
                  options.accepting.delete(id);
                });
              options.accepting.set(id, acceptance);
            }
            await acceptance;
          }
          await options.ack(envelope.id);
          options.accepted.delete(envelope.id);
        }
      } while (requested && !options.disposed());
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
}
