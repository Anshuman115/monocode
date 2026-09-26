import { attachmentPathText } from "../../../../features/sessions/model/attachments";
import { nativeModelId } from "../../../../features/sessions/model/models";
import type {
  Attachment,
  ToolPreview,
} from "../../../../features/sessions/model/session";
import { extractToolPreview } from "../../core/preview";
import {
  closeChildStdin,
  killChild,
  resolveCommandCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "../../core/child";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";
import {
  asRecord,
  buildCommandCodeArgs,
  redactCommandCodeDiagnostic,
  stringField,
  toolKind,
  toolResultText,
  type CommandCodeEvent,
  parseCommandCodeLine,
} from "./commandCodeProtocol";

type Resume = { providerSessionId: string; cwd: string };

type Live = {
  cwd: string;
  providerSessionId?: string;
  onEvent: (event: HarnessEvent) => void;
  cancelled: boolean;
  muted: boolean;
  lastStderr: string;
  assistantText: string;
  reasoningText: string;
  messageOpen: boolean;
  messageCompleted: boolean;
  reasoningOpen: boolean;
  sawResult: boolean;
  errorEmitted: boolean;
  finish?: (error?: Error) => void;
  turnNumber: number;
};

const liveByThread = new Map<string, Live>();
const resumeByThread = new Map<string, Resume>();
const cancelledThreads = new Set<string>();

const STARTUP_TIMEOUT_MS = 15_000;
const TURN_TIMEOUT_MS = 30 * 60_000;

export async function sendCommandCodeTurn(input: SendTurnInput): Promise<void> {
  const live: Live = {
    cwd: input.cwd,
    onEvent: input.onEvent,
    cancelled: false,
    muted: false,
    lastStderr: "",
    assistantText: "",
    reasoningText: "",
    messageOpen: false,
    messageCompleted: false,
    reasoningOpen: false,
    sawResult: false,
    errorEmitted: false,
    turnNumber: 0,
  };
  liveByThread.set(input.sessionId, live);
  try {
    const resume = resumeByThread.get(input.sessionId);
    if (resume && resume.cwd !== input.cwd) {
      throw new Error(
        "Command Code session is bound to a different working directory",
      );
    }
    const { path } = await resolveCommandCodeBinary();
    if (cancelledThreads.delete(input.sessionId) || live.cancelled) return;
    const prompt = promptWithAttachments(input.text, input.attachments);
    const args = buildCommandCodeArgs({
      model: nativeModelId(input.model),
      effort: input.modelSettings?.effort,
      runtimeMode: input.runtimeMode,
      intent: input.intent,
      resume: resume?.providerSessionId,
    });
    await runProcess(input, live, path, args, prompt);
  } finally {
    if (liveByThread.get(input.sessionId) === live)
      liveByThread.delete(input.sessionId);
  }
}

export async function cancelCommandCodeTurn(sessionId: string): Promise<void> {
  const live = liveByThread.get(sessionId);
  if (!live) {
    cancelledThreads.add(sessionId);
    return;
  }
  live.cancelled = true;
  live.muted = true;
  await killChild(sessionId).catch(() => undefined);
  live.finish?.();
}

export async function stopCommandCodeSession(sessionId: string): Promise<void> {
  cancelledThreads.delete(sessionId);
  const live = liveByThread.get(sessionId);
  if (live) {
    live.cancelled = true;
    live.muted = true;
  }
  await killChild(sessionId).catch(() => undefined);
  live?.finish?.();
}

export async function forgetCommandCodeSession(
  sessionId: string,
): Promise<void> {
  resumeByThread.delete(sessionId);
  await stopCommandCodeSession(sessionId);
}

export function bindCommandCodeSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const id = providerSessionId.trim();
  if (!threadId || !id || !cwd.trim() || !isSafeProviderSessionId(id)) return;
  resumeByThread.set(threadId, { providerSessionId: id, cwd });
}

export async function steerCommandCodeTurn(
  _input: SteerTurnInput,
): Promise<void> {
  throw new Error(
    "Command Code headless mode does not support steering an active turn",
  );
}

export function respondCommandCodeApproval(
  _sessionId: string,
  _requestId: number,
  _decision: ApprovalDecision,
): void {}

async function runProcess(
  input: SendTurnInput,
  live: Live,
  path: string,
  args: string[],
  prompt: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let sawStartup = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let turnTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (turnTimer) clearTimeout(turnTimer);
      unwatchChild(input.sessionId);
      if (live.finish === finish) live.finish = undefined;
      if (error) emitSessionError(input, live, error.message);
      if (error && !live.cancelled) reject(error);
      else resolve();
    };
    live.finish = finish;

    const onLine = (line: string) => {
      if (live.muted) return;
      const parsed = parseCommandCodeLine(line);
      if (!parsed) return;
      if (parsed.kind === "event") {
        sawStartup = true;
        if (startupTimer) clearTimeout(startupTimer);
        handleEvent(input, live, parsed.event);
        return;
      }
      sawStartup = true;
      live.sawResult = true;
      handleResult(input, live, parsed.result);
    };

    watchChild(
      input.sessionId,
      onLine,
      (code) => {
        if (!live.muted) {
          input.onEvent({ type: "session.ended", code });
        }
        if (live.cancelled) {
          finish();
          return;
        }
        if (!live.sawResult || code !== 0) {
          const detail = live.lastStderr || exitMessage(code);
          finish(new Error(detail));
          return;
        }
        finish();
      },
      (line) => {
        const trimmed = line.trim();
        if (trimmed) live.lastStderr = redactCommandCodeDiagnostic(trimmed);
      },
    );

    startupTimer = setTimeout(() => {
      if (sawStartup || settled) return;
      live.muted = true;
      void killChild(input.sessionId).finally(() =>
        finish(new Error("Command Code did not start its JSON stream in time")),
      );
    }, STARTUP_TIMEOUT_MS);
    turnTimer = setTimeout(() => {
      if (settled) return;
      live.muted = true;
      void killChild(input.sessionId).finally(() =>
        finish(new Error("Command Code turn timed out")),
      );
    }, TURN_TIMEOUT_MS);

    void spawnChild(input.sessionId, path, args, input.cwd)
      .then(() => writeChild(input.sessionId, prompt))
      // Closing stdin is what marks the prompt complete for `--print`.
      .then(() => closeChildStdin(input.sessionId))
      .catch((error: unknown) => {
        void killChild(input.sessionId).catch(() => undefined);
        finish(new Error(redactCommandCodeDiagnostic(String(error))));
      });
  });
}

function handleEvent(
  input: SendTurnInput,
  live: Live,
  event: CommandCodeEvent,
): void {
  if (live.muted) return;
  switch (event.type) {
    case "run_start": {
      const id = stringField(event, "sessionId");
      if (id && isSafeProviderSessionId(id)) {
        live.providerSessionId = id;
        resumeByThread.set(input.sessionId, {
          providerSessionId: id,
          cwd: input.cwd,
        });
        input.onEvent({ type: "session.providerBound", providerSessionId: id });
      }
      input.onAccepted?.();
      input.onEvent({ type: "session.started" });
      break;
    }
    case "turn_start": {
      live.turnNumber = numberField(event, "turnNumber");
      input.onEvent({
        type: "turn.started",
        providerTurnId: `${live.providerSessionId ?? input.sessionId}:${live.turnNumber}`,
      });
      break;
    }
    case "model_request_start": {
      const model = stringField(event, "model");
      if (model) input.onEvent({ type: "status", text: `Using ${model}` });
      break;
    }
    case "message_start":
      live.messageOpen = true;
      live.messageCompleted = false;
      break;
    case "text_delta": {
      const delta = stringField(event, "delta");
      if (delta) {
        live.assistantText += delta;
        input.onEvent({ type: "message.delta", text: delta });
      }
      break;
    }
    case "thinking_start":
      live.reasoningOpen = true;
      break;
    case "thinking_delta": {
      const delta = stringField(event, "delta");
      if (delta) {
        live.reasoningText += delta;
        input.onEvent({ type: "reasoning.delta", text: delta });
      }
      break;
    }
    case "thinking_end":
      completeReasoning(input, live);
      break;
    case "message_end":
      completeReasoning(input, live);
      if (live.messageOpen) {
        input.onEvent({ type: "message.completed" });
        live.messageOpen = false;
        live.messageCompleted = true;
      }
      break;
    case "tool_queued":
      emitToolStarted(input, event, "pending");
      break;
    case "tool_running":
      emitToolUpdated(input, event, "in_progress");
      break;
    case "tool_update":
      emitToolUpdated(
        input,
        event,
        "in_progress",
        commandCodeToolResultText(event.partial),
      );
      break;
    case "tool_completed":
      emitToolUpdated(
        input,
        event,
        "completed",
        commandCodeToolResultText(event.result),
      );
      break;
    case "tool_errored":
      emitToolUpdated(
        input,
        event,
        "failed",
        commandCodeToolResultText(event.error ?? event.result),
      );
      break;
    case "tool_hook_blocked":
      emitToolUpdated(input, event, "failed", stringField(event, "hookOutput"));
      break;
    case "tool_denied":
      emitToolUpdated(
        input,
        event,
        "failed",
        commandCodeToolResultText(event.reason ?? event.error ?? event.result),
      );
      break;
    case "model_request_end":
      emitUsage(input, asRecord(event.usage));
      break;
    case "run_end": {
      const result = asRecord(event.result);
      if (result) {
        emitUsage(input, asRecord(result.usage));
        emitFinalTextIfNeeded(input, live, stringField(result, "finalText"));
        const stopReason = stringField(result, "stopReason");
        if (stopReason === "error") {
          emitSessionError(input, live, commandCodeFailureText(result));
        }
      }
      break;
    }
    // Emitted by the CLI run loop but deliberately not surfaced: turn_end (its
    // text and usage are already reported), message_update and model_trace (the
    // deltas and the result frame are authoritative), interaction_requested/
    // resolved and permission_mode_changed (headless has no approval channel),
    // compaction_start/done/outcome, subagent_start/stop/progress,
    // continuation_recovery, session_shutdown, session_titled,
    // config_setting_changed, skill_loaded. run_error is left to the result
    // frame, which is authoritative for a failed run.
    default:
      break;
  }
}

function handleResult(
  input: SendTurnInput,
  live: Live,
  result: Record<string, unknown>,
): void {
  emitUsage(input, asRecord(result.usage));
  emitFinalTextIfNeeded(input, live, stringField(result, "finalText"));
  if (result.subtype !== "success") {
    emitSessionError(input, live, commandCodeFailureText(result));
  }
}

function emitSessionError(
  input: SendTurnInput,
  live: Live,
  message: string,
): void {
  if (live.errorEmitted || live.cancelled) return;
  live.errorEmitted = true;
  input.onEvent({ type: "session.error", message });
}

function commandCodeToolResultText(value: unknown): string {
  const direct = toolResultText(value);
  if (direct) return direct;
  const record = asRecord(value);
  return (
    toolResultText(record?.content) ||
    stringField(record, "error") ||
    stringField(record, "message") ||
    ""
  );
}

function emitFinalTextIfNeeded(
  input: SendTurnInput,
  live: Live,
  finalText: string | undefined,
): void {
  if (finalText && !live.assistantText) {
    live.assistantText = finalText;
    input.onEvent({ type: "message.delta", text: finalText });
  }
  completeReasoning(input, live);
  if (
    !live.messageCompleted &&
    (live.messageOpen || finalText || live.assistantText)
  ) {
    input.onEvent({ type: "message.completed" });
    live.messageOpen = false;
    live.messageCompleted = true;
  }
}

function completeReasoning(input: SendTurnInput, live: Live): void {
  if (!live.reasoningOpen && !live.reasoningText) return;
  input.onEvent({ type: "reasoning.completed" });
  live.reasoningOpen = false;
  live.reasoningText = "";
}

function emitToolStarted(
  input: SendTurnInput,
  event: CommandCodeEvent,
  status: string,
): void {
  const callId = stringField(event, "toolCallId");
  const name = stringField(event, "toolName");
  if (!callId || !name) return;
  const rawInput = asRecord(event.input) ?? {};
  input.onEvent({
    type: "tool.started",
    callId,
    title: name,
    kind: toolKind(name),
    status,
    preview: previewForTool(name, rawInput),
  });
}

function emitToolUpdated(
  input: SendTurnInput,
  event: CommandCodeEvent,
  status: string,
  detail?: string,
): void {
  const callId = stringField(event, "toolCallId");
  const name = stringField(event, "toolName");
  if (!callId) return;
  const rawInput = asRecord(event.input) ?? {};
  input.onEvent({
    type: "tool.updated",
    callId,
    ...(name ? { title: name, kind: toolKind(name) } : {}),
    status,
    ...(detail ? { detail: detail.slice(0, 20_000) } : {}),
    ...(name ? { preview: previewForTool(name, rawInput) } : {}),
  });
}

function previewForTool(
  name: string,
  input: Record<string, unknown>,
): ToolPreview | undefined {
  return extractToolPreview({ name, input }, { name, input });
}

function emitUsage(
  input: SendTurnInput,
  usage: Record<string, unknown> | null,
): void {
  if (!usage) return;
  const inputTokens = numberField(usage, "inputTokens");
  const outputTokens = numberField(usage, "outputTokens");
  const cacheReadTokens = numberField(usage, "cacheReadTokens");
  const cacheWriteTokens = numberField(usage, "cacheWriteTokens");
  if (!inputTokens && !outputTokens && !cacheReadTokens && !cacheWriteTokens)
    return;
  input.onEvent({
    type: "turn.metrics",
    ...(inputTokens ? { inputTokens } : {}),
    ...(outputTokens ? { outputTokens } : {}),
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
  });
}

function promptWithAttachments(
  text: string,
  attachments: Attachment[] = [],
): string {
  const paths = attachments.map(attachmentPathText).filter(Boolean);
  return paths.length === 0
    ? text
    : `${text}\n\nAttached paths:\n${paths.join("\n")}`;
}

function isSafeProviderSessionId(value: string): boolean {
  return /^[A-Za-z0-9._-]{8,128}$/.test(value);
}

function numberField(value: Record<string, unknown>, key: string): number {
  const number = value[key];
  return typeof number === "number" && Number.isFinite(number) ? number : 0;
}

function exitMessage(code: number | null): string {
  if (code === 3)
    return "Command Code is not authenticated. Run `command-code login` and retry.";
  if (code === 4)
    return "Command Code denied a tool because headless approval is unavailable.";
  if (code === 130) return "Command Code was interrupted.";
  return `Command Code exited${code == null ? " unexpectedly" : ` with code ${code}`}.`;
}

function commandCodeFailureText(result: Record<string, unknown>): string {
  const error = stringField(result, "error");
  if (error) return redactCommandCodeDiagnostic(error);
  const subtype = stringField(result, "subtype");
  return subtype === "auth_error"
    ? "Command Code is not authenticated. Run `command-code login` and retry."
    : "Command Code did not complete the turn.";
}
