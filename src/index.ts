import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { zulipPlugin } from "./plugin.js";

export default defineChannelPluginEntry({
  id: "zulip",
  name: "Zulip",
  description: "OpenClaw channel plugin for Zulip — streams, topics, DMs, and ACP topic bindings.",
  plugin: zulipPlugin,
});
