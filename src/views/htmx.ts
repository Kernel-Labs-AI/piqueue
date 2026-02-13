export type HtmxAttributeMap = Record<string, string>;

export function hx<T extends HtmxAttributeMap>(attrs: T): T {
  return attrs;
}
