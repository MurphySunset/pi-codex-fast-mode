import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "local-fast-mode";
const STATE_ENTRY = "local-fast-mode";
const CODEX_PROVIDER = "openai-codex";
const CODEX_API = "openai-codex-responses";
const FAST_SERVICE_TIER = "priority";
const FAST_RGB = [255, 95, 255] as const;
const STD_RGB = [95, 255, 95] as const;

function rgbForeground(text: string, [r, g, b]: readonly [number, number, number]): string {
  return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`;
}

// Keep this allowlist narrow: these are the Codex models known to accept the
// upstream priority tier. API-key auth is deliberately excluded below.
const SUPPORTED_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]);

type ModelRef = {
  provider?: string;
  api?: string;
  id?: string;
};

type FastStateEntry = {
  modelKey: string;
  enabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getModelKey(model: ModelRef | undefined): string | undefined {
  if (!model?.provider || !model.api || !model.id) return undefined;
  return `${model.provider}/${model.api}/${model.id}`;
}

function getModelLabel(ctx: ExtensionContext): string {
  const model = ctx.model;
  return model ? `${model.provider}/${model.id}` : "aucun modèle";
}

function isFastEligible(ctx: ExtensionContext): boolean {
  const model = ctx.model;
  if (
    !model ||
    model.provider !== CODEX_PROVIDER ||
    model.api !== CODEX_API ||
    !SUPPORTED_MODELS.has(model.id)
  ) {
    return false;
  }

  // This only checks Pi's auth mode; it never reads or displays credentials.
  try {
    return ctx.modelRegistry.isUsingOAuth(model);
  } catch {
    return false;
  }
}

function restoreState(states: Map<string, boolean>, ctx: ExtensionContext): void {
  states.clear();

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
    if (!isRecord(entry.data)) continue;

    const data = entry.data as Partial<FastStateEntry>;
    if (typeof data.modelKey === "string" && typeof data.enabled === "boolean") {
      states.set(data.modelKey, data.enabled);
    }
  }
}

function isFastActive(states: Map<string, boolean>, ctx: ExtensionContext): boolean {
  const key = getModelKey(ctx.model);
  return key !== undefined && states.get(key) === true && isFastEligible(ctx);
}

function updateStatus(states: Map<string, boolean>, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(
    STATUS_KEY,
    isFastActive(states, ctx) ? rgbForeground("FAST", FAST_RGB) : rgbForeground("STD", STD_RGB),
  );
}

function persistState(
  pi: ExtensionAPI,
  states: Map<string, boolean>,
  ctx: ExtensionContext,
  enabled: boolean,
): boolean {
  const key = getModelKey(ctx.model);
  if (!key) return false;

  if (states.get(key) !== enabled) {
    states.set(key, enabled);
    // Session state only: no settings.json/keybindings.json is modified.
    pi.appendEntry<FastStateEntry>(STATE_ENTRY, { modelKey: key, enabled });
  }

  updateStatus(states, ctx);
  return true;
}

function notifyStatus(states: Map<string, boolean>, ctx: ExtensionContext): void {
  updateStatus(states, ctx);

  if (isFastActive(states, ctx)) {
    ctx.ui.notify(`⚠️FAST — ${getModelLabel(ctx)}`, "info");
    return;
  }

  const key = getModelKey(ctx.model);
  if (key && states.get(key) === true) {
    ctx.ui.notify(
      `STD — fast mode indisponible pour ${getModelLabel(ctx)} (Codex OAuth et modèle compatible requis).`,
      "warning",
    );
    return;
  }

  ctx.ui.notify(`STD — ${getModelLabel(ctx)}`, "info");
}

export default function fastMode(pi: ExtensionAPI): void {
  const states = new Map<string, boolean>();

  pi.registerFlag("fast", {
    description: "Start with Codex fast mode (priority service tier)",
    type: "boolean",
    default: false,
  });

  const refreshStatus = (ctx: ExtensionContext): void => {
    // A CLI flag acts as the default for each model that has not been
    // explicitly configured with /fast on|off in the current session.
    if (pi.getFlag("fast") === true) {
      const key = getModelKey(ctx.model);
      if (key && !states.has(key)) states.set(key, true);
    }

    updateStatus(states, ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    restoreState(states, ctx);
    refreshStatus(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreState(states, ctx);
    refreshStatus(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    refreshStatus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    states.clear();
  });

  pi.on("before_provider_request", (event, ctx) => {
    refreshStatus(ctx);

    if (!isFastActive(states, ctx)) return undefined;
    if (!isRecord(event.payload) || event.payload.model !== ctx.model?.id) return undefined;

    // Do not overwrite an explicit provider payload value.
    if ("service_tier" in event.payload) return undefined;

    return {
      ...event.payload,
      service_tier: FAST_SERVICE_TIER,
    };
  });

  pi.registerCommand("fast", {
    description: "Fast mode Codex local: /fast on|off|status",
    getArgumentCompletions: (prefix) => {
      const normalized = prefix.trim().toLowerCase();
      return ["on", "off", "status"]
        .filter((value) => value.startsWith(normalized))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action !== "on" && action !== "off" && action !== "status") {
        ctx.ui.notify("Usage : /fast on|off|status", "warning");
        return;
      }

      if (action === "status") {
        refreshStatus(ctx);
        notifyStatus(states, ctx);
        return;
      }

      if (action === "on") {
        if (!isFastEligible(ctx)) {
          updateStatus(states, ctx);
          ctx.ui.notify(
            `Fast mode refusé pour ${getModelLabel(ctx)} : Codex OAuth et un modèle compatible sont requis.`,
            "warning",
          );
          return;
        }

        if (!persistState(pi, states, ctx, true)) {
          ctx.ui.notify("Fast mode refusé : aucun modèle sélectionné.", "warning");
          return;
        }

        ctx.ui.notify(`FAST activé pour ${getModelLabel(ctx)}.`, "info");
        return;
      }

      if (!persistState(pi, states, ctx, false)) {
        updateStatus(states, ctx);
        ctx.ui.notify("Fast mode désactivé (aucun modèle sélectionné).", "info");
        return;
      }

      ctx.ui.notify(`STD pour ${getModelLabel(ctx)}.`, "info");
    },
  });
}
