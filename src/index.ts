import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { setZulipRuntime } from "./runtime.js";
import { zulipPlugin } from "./plugin.js";

const entry: ReturnType<typeof defineChannelPluginEntry<typeof zulipPlugin>> = defineChannelPluginEntry({
  id: "zulip",
  name: "Zulip",
  description: "OpenClaw channel plugin for Zulip — streams, topics, DMs, and ACP topic bindings.",
  plugin: zulipPlugin,
  setRuntime: setZulipRuntime,
});

export default entry;
