import { describe, expect, it } from "vitest";
import {
  attachOrchestrationWorkers,
  consolidateOrchestrationTabs,
} from "./orchestrationWorkspace";
import { leafIds, newTab, splitPane } from "./layout";
import { newSession } from "./session";
import type { OrchestrationRun, OrchestrationTask } from "./orchestration";

const tasks: OrchestrationTask[] = ["worker-a", "worker-b"].map(
  (sessionId) => ({
    id: sessionId,
    sessionId,
    title: sessionId,
    harness: "claude",
    model: "claude:test",
    prompt: "Work",
    files: [sessionId],
    scopes: [`/repo/${sessionId}`],
    dependsOn: [],
    status: "running",
    accepted: false,
    result: "",
    delivered: false,
  }),
);
const run: OrchestrationRun = {
  version: 1,
  leadId: "lead",
  cwd: "/repo",
  status: "active",
  allowedHarnesses: ["claude"],
  maxWorkers: 2,
  cli: "monocode",
  tasks,
  continuations: 0,
  requests: {},
};

describe("orchestration workspace", () => {
  it("folds earlier worker tabs into the lead and moves focus back to it", () => {
    const tabs = [
      newTab("lead"),
      newTab("worker-a"),
      newTab("worker-b"),
      newTab("unrelated"),
    ];
    const result = consolidateOrchestrationTabs(tabs, tabs[1].id, [run]);
    expect(result.tabs).toEqual([tabs[0], tabs[3]]);
    expect(result.activeTabId).toBe(tabs[0].id);
    expect(
      consolidateOrchestrationTabs(result.tabs, result.activeTabId, [run]).tabs,
    ).toBe(result.tabs);
  });
  it("keeps unrelated panes when a worker shared a split tab", () => {
    const lead = newTab("lead");
    const split = newTab("worker-a");
    split.layout = splitPane(split.layout, "worker-a", "right", "unrelated");
    const result = consolidateOrchestrationTabs([lead, split], lead.id, [run]);
    expect(result.tabs).toHaveLength(2);
    expect(leafIds(result.tabs[1].layout)).toEqual(["unrelated"]);
    expect(result.tabs[1].focusedId).toBe("unrelated");
  });
  it("retains worker ownership for tabless sessions and leaves other sessions intact", () => {
    const sessions = ["lead", "worker-a", "worker-b", "unrelated"].map(
      (id) => ({ ...newSession("claude", "/repo"), id }),
    );
    const next = attachOrchestrationWorkers(sessions, [run]);
    expect(next[0]).toBe(sessions[0]);
    expect(next[1].orchestrationLeadId).toBe("lead");
    expect(next[2].orchestrationLeadId).toBe("lead");
    expect(next[3]).toBe(sessions[3]);
    expect(attachOrchestrationWorkers(next, [run])).toBe(next);
  });
});
