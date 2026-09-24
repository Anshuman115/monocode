import { expect, it, vi } from "vitest";
import { launchReceiver } from "./launchDelivery";
const request = { prompt: "go", cwd: "/repo", harness: "codex", reveal: false };
function setup() {
  const queue = [
    { id: "first", request },
    { id: "second", request },
  ];
  const accept = vi.fn(async () => {});
  const ack = vi.fn(async (id: string) => {
    const index = queue.findIndex((item) => item.id === id);
    if (index >= 0) queue.splice(index, 1);
  });
  const options = {
    take: vi.fn(async (): Promise<unknown> => queue[0] ?? null),
    accept,
    ack,
    disposed: () => false,
    accepted: new Set<string>(),
    accepting: new Map<string, Promise<void>>(),
  };
  return { queue, options, receive: launchReceiver(options) };
}
it("serializes mount/focus/event triggers and acknowledges each accepted launch", async () => {
  const { receive, options, queue } = setup();
  await Promise.all([receive(), receive(), receive()]);
  expect(options.accept.mock.calls.map((call) => call[1])).toEqual([
    "first",
    "second",
  ]);
  expect(queue).toHaveLength(0);
});
it("retains failed and invalid handoffs without acknowledging them", async () => {
  const { receive, options, queue } = setup();
  options.accept.mockRejectedValueOnce(new Error("not ready"));
  await expect(receive()).rejects.toThrow("not ready");
  expect(options.ack).not.toHaveBeenCalled();
  expect(queue).toHaveLength(2);
  options.take.mockResolvedValueOnce({
    id: "first",
    request: { prompt: "malformed" },
  });
  await expect(receive()).rejects.toThrow("Invalid queued session");
  expect(options.ack).not.toHaveBeenCalled();
  await receive();
  expect(queue).toHaveLength(0);
});
it("retries a lost ACK without starting the session again", async () => {
  const { receive, options, queue } = setup();
  options.ack.mockRejectedValueOnce(new Error("IPC interrupted"));
  await expect(receive()).rejects.toThrow("IPC interrupted");
  expect(queue).toHaveLength(2);
  await receive();
  expect(options.accept).toHaveBeenCalledTimes(2);
  expect(options.ack).toHaveBeenCalledTimes(3);
  expect(queue).toHaveLength(0);
});
it("keeps the launch queued if the component unmounts during a take", async () => {
  const { receive, options, queue } = setup();
  options.take.mockImplementationOnce(async () => {
    options.disposed = () => true;
    return queue[0];
  });
  await receive();
  expect(options.accept).not.toHaveBeenCalled();
  expect(options.ack).not.toHaveBeenCalled();
  expect(queue).toHaveLength(2);
});
it("shares an in-flight acceptance across effect remounts", async () => {
  const { receive, options, queue } = setup();
  let resolve!: () => void;
  options.accept.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const first = receive();
  await Promise.resolve();
  const second = launchReceiver(options)();
  await Promise.resolve();
  expect(options.ack).not.toHaveBeenCalled();
  resolve();
  await Promise.all([first, second]);
  expect(options.accept).toHaveBeenCalledTimes(2);
  expect(queue).toHaveLength(0);
});
