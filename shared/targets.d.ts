export interface TargetMeta {
  id: string;
  label: string;
  short: string;
  badge: string;
  dot: string;
  pathHint: string;
}

export const TARGETS: ReadonlyArray<TargetMeta>;

export const TARGET_IDS: string[];

export function getTargetMeta(id: string): TargetMeta;
