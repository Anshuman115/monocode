import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type Event } from "@tauri-apps/api/event";
import { loadQuickComposerEnabled } from "../../settings/model/settings";
import { prepareQuickComposerWhenIdle } from "../model/prepareQuickComposer";
import {
  liveQuickCatalog,
  isHarnessId,
  parseQuickLaunch,
  QUICK_COMPOSER_CATALOG_EVENT,
  QUICK_COMPOSER_CATALOG_REQUEST_EVENT,
  QUICK_COMPOSER_LAUNCH_EVENT,
  quickComposerSupported,
  setQuickComposerShortcut,
  type QuickLaunch,
} from "../model/quickComposer";

/**
 * Claims the global shortcut per the setting, answers the panel's requests for
 * model catalogs, and starts the sessions the quick composer hands this window. The backend holds a launch until its
 * window asks, so one sent while this window was still booting is picked up
 * on mount, and a missed event on the next focus.
 */
export function useQuickComposerLaunches(
  onLaunch: (launch: QuickLaunch) => void,
) {
  const onLaunchRef = useRef(onLaunch);
  onLaunchRef.current = onLaunch;

  useEffect(() => {
    if (!quickComposerSupported()) return;
    const stopPreparing = prepareQuickComposerWhenIdle();
    void setQuickComposerShortcut(loadQuickComposerEnabled()).catch(
      () => undefined,
    );

    let disposed = false;
    const take = async () => {
      if (disposed) return;
      try {
        const launch = parseQuickLaunch(
          await invoke<unknown>("quick_composer_take"),
        );
        if (launch && !disposed) onLaunchRef.current(launch);
      } catch {
        // The launch stays queued in the backend for the next attempt.
      }
    };
    const onFocus = () => void take();
    const subscriptions: Array<() => void> = [];
    const subscribe = async (
      event: string,
      handler: (event: Event<unknown>) => void,
    ) => {
      const stop = await listen(event, handler);
      if (disposed) stop();
      else subscriptions.push(stop);
    };
    void Promise.all([
      subscribe(QUICK_COMPOSER_LAUNCH_EVENT, () => void take()),
      subscribe(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, (event) => {
        void probeHarnessAvailability()
          .then(async () => {
            if (disposed) return;
            void emit(QUICK_COMPOSER_CATALOG_EVENT, liveQuickCatalog());
            // Only probe the provider the user opened, like the workspace picker.
            if (isHarnessId(event.payload)) {
              await refreshHarnessCatalogs([event.payload]);
              if (!disposed)
                void emit(QUICK_COMPOSER_CATALOG_EVENT, liveQuickCatalog());
            }
          })
          .catch(() => undefined);
      }),
    ])
      .then(() => take())
      .catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      stopPreparing();
      for (const stop of subscriptions) stop();
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
