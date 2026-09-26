import { execChild, resolveCommandCodeBinary } from "../../core/child";
import type { HarnessAvailabilityDetail } from "../../core/availabilityState";
import {
  compareCommandCodeVersions,
  hasCommandCodeJsonHeadlessSupport,
  MINIMUM_COMMAND_CODE_VERSION,
  parseCommandCodeStatus,
  parseCommandCodeVersion,
} from "./commandCodeProtocol";

export async function probeCommandCodeAvailability(): Promise<{
  available: boolean;
  detail: HarnessAvailabilityDetail;
}> {
  const { path } = await resolveCommandCodeBinary();
  const version = parseCommandCodeVersion(
    await execChild(path, ["--no-auto-update", "--version"], undefined, "command-code"),
  );
  if (
    !version ||
    compareCommandCodeVersions(version, MINIMUM_COMMAND_CODE_VERSION) < 0
  ) {
    return {
      available: false,
      detail: {
        state: "unsupported",
        ...(version ? { version } : {}),
        message: `Command Code ${version ? `v${version}` : "version"} does not support MonoCode's JSON headless transport. Upgrade to v${MINIMUM_COMMAND_CODE_VERSION} or newer.`,
      },
    };
  }
  const help = await execChild(path, ["--no-auto-update", "--help"], undefined, "command-code");
  if (!hasCommandCodeJsonHeadlessSupport(help)) {
    return {
      available: false,
      detail: {
        state: "unsupported",
        version,
        message:
          "Command Code CLI does not document the JSON headless transport required by MonoCode.",
      },
    };
  }

  const status = parseCommandCodeStatus(
    await execChild(path, ["--no-auto-update", "status", "--json"], undefined, "command-code"),
  );
  if (!status) {
    return {
      available: false,
      detail: {
        state: "limited",
        version,
        message:
          "Command Code CLI returned an unreadable authentication status. Run `command-code status --json`, then retry.",
      },
    };
  }
  if (!status.authenticated) {
    return {
      available: false,
      detail: {
        state: "unauthenticated",
        version,
        message:
          "Command Code CLI is installed but not authenticated. Run `command-code login`, then retry.",
      },
    };
  }
  return {
    available: true,
    detail: { state: "available", version },
  };
}
