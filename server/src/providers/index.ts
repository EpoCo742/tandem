import { copilotProvider } from "./copilot.js";
import { fakeProvider } from "./fake.js";
import type { ProviderAdapter } from "./types.js";

const registry: Record<string, ProviderAdapter> = {
  copilot: copilotProvider,
  fake: fakeProvider,
};

export function getProvider(id: string): ProviderAdapter {
  const p = registry[id];
  if (!p) throw new Error(`Unknown provider ${id}`);
  return p;
}

export function providerIds(): string[] {
  return Object.keys(registry);
}
