import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

export const {
  getRuntime: getZulipRuntime,
  setRuntime: setZulipRuntime,
  clearRuntime: clearZulipRuntime,
} =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "zulip",
    errorMessage: "Zulip runtime has not been initialized",
  });
