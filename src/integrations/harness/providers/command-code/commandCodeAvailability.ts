import { execChild, resolveCommandCodeBinary } from "../../core/child";
import type { HarnessAvailabilityDetail } from "../../core/availabilityState";
import {
  compareCommandCodeVersions,
  MINIMUM_COMMAND_CODE_VERSION,
  parseCommandCodeVersion,
} from "./commandCodeProtocol";

export async function probeCommandCodeAvailability(): Promise<{
  available: boolean;
  detail: HarnessAvailabilityDetail;
}> {
  const { path } = await resolveCommandCodeBinary();
  const version = parseCommandCodeVersion(await execChild(path, ["--version"]));
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
  try {
    const status = JSON.parse(await execChild(path, ["status", "--json"])) as {
      authenticated?: boolean;
    };
    return {
      available: true,
      detail: {
        state: status.authenticated === false ? "unauthenticated" : "available",
        version,
        ...(status.authenticated === false
          ? {
              message:
                "Command Code CLI is installed but not authenticated. Run `command-code login`, then retry.",
            }
          : {}),
      },
    };
  } catch {
    return {
      available: true,
      detail: {
        state: "limited",
        version,
        message: "Command Code CLI is installed with limited capabilities.",
      },
    };
  }
}
