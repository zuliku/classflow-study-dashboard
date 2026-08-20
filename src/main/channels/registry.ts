/**
 * Channel Registry — Task 13
 * Factory registry for ChannelType → adapter creation
 * Future can support QQ Bot, Gmail, QQ Mail without Manager coupling to QQ-specific logic
 */

import type { ChannelFactory, ChannelType } from "./types";
import type { QQChannelConfig } from "./qq/config";

const factories = new Map<ChannelType, ChannelFactory>();

export function registerChannelFactory(type: ChannelType, factory: ChannelFactory): void {
  factories.set(type, factory);
}

export function getChannelFactory(type: ChannelType): ChannelFactory | undefined {
  return factories.get(type);
}

export function listRegisteredChannelTypes(): ChannelType[] {
  return Array.from(factories.keys());
}

export function createChannelAdapter(type: ChannelType, config: QQChannelConfig) {
  const factory = factories.get(type);
  if (!factory) throw new Error(JSON.stringify({ code: "CHANNEL_NOT_FOUND", message: `No factory for ${type}` }));
  return factory(config);
}

// Only for tests
export function __clearChannelRegistryForTest(): void {
  factories.clear();
}
