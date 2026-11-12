import assert from "node:assert/strict";
import { test } from "node:test";
import fastMode from "../extensions/fast-mode.ts";

function setup({ id = "gpt-6-luna", provider = "openai-codex", api = "openai-codex-responses", oauth = true, flag = false } = {}) {
  const events = new Map();
  const commands = new Map();
  const entries = [];
  const notifications = [];
  const ctx = {
    model: { id, provider, api },
    hasUI: false,
    modelRegistry: { isUsingOAuth: () => oauth },
    sessionManager: { getBranch: () => entries },
    ui: { notify: (text) => notifications.push(text) },
  };
  fastMode({
    registerFlag() {},
    getFlag: () => flag,
    on: (name, handler) => events.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
  });
  events.get("session_start")({}, ctx);
  return {
    ctx, entries, notifications,
    command: (action) => commands.get("fast").handler(action, ctx),
    request: (payload = { model: ctx.model.id }) => events.get("before_provider_request")({ payload }, ctx),
    restore: () => events.get("session_tree")({}, ctx),
  };
}

test("gpt-6-luna: /fast on injects priority without mutating the payload; off disables it", async () => {
  const h = setup();
  assert.equal(h.request(), undefined);
  await h.command("on");
  const payload = { model: "gpt-6-luna", input: [] };
  assert.deepEqual(h.request(payload), { ...payload, service_tier: "priority" });
  assert.equal(payload.service_tier, undefined);
  h.restore();
  assert.equal(h.request().service_tier, "priority");
  await h.command("off");
  assert.equal(h.request(), undefined);
});

test("--fast enables gpt-6-luna and explicit off survives session restore", async () => {
  const h = setup({ flag: true });
  assert.equal(h.request().service_tier, "priority");
  await h.command("off");
  h.restore();
  assert.equal(h.request(), undefined);
});

test("preserves explicit tiers and ignores malformed or mismatched payloads", () => {
  const h = setup({ flag: true });
  for (const payload of [null, [], "invalid", { model: "other" }, { model: "gpt-6-luna", service_tier: "default" }]) {
    assert.equal(h.request(payload), undefined);
  }
});

test("requires a supported Codex OAuth model", async () => {
  for (const options of [{ provider: "openai" }, { api: "openai-responses" }, { oauth: false }, { id: "unknown" }]) {
    const h = setup({ ...options, flag: true });
    await h.command("on");
    assert.equal(h.request(), undefined);
    assert.equal(h.entries.length, 0);
    assert.match(h.notifications.at(-1), /refusé/);
  }
});

test("previous supported models still accept priority", () => {
  for (const id of ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
    assert.equal(setup({ id, flag: true }).request().service_tier, "priority");
  }
});

test("activation remains per model", async () => {
  const h = setup();
  await h.command("on");
  h.ctx.model = { ...h.ctx.model, id: "gpt-5.6-luna" };
  assert.equal(h.request(), undefined);
  h.ctx.model = { ...h.ctx.model, id: "gpt-6-luna" };
  assert.equal(h.request().service_tier, "priority");
});
