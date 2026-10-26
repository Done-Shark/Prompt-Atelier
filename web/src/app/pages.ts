export const PAGES = ['prompts', 'gallery-nai', 'gallery-comfy', 'tags', 'rp', 'settings'] as const;

export type Page = (typeof PAGES)[number];

export function isPage(value: string): value is Page {
  return (PAGES as readonly string[]).includes(value);
}
