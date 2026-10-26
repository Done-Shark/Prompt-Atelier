export type SegmentKind =
  | 'artist'
  | 'subject'
  | 'appearance'
  | 'clothing'
  | 'pose'
  | 'expression'
  | 'scene'
  | 'composition'
  | 'style'
  | 'lora'
  | 'custom'
  | 'unsorted';

export interface PromptTag {
  id: string;
  text: string;
  enabled: boolean;
}

export interface PromptSegment {
  id: string;
  kind: SegmentKind;
  label: string;
  tags: PromptTag[];
}

export type TokenType = 'text' | 'weight' | 'weight-neg' | 'lora' | 'sep' | 'paren';

export interface PromptToken {
  type: TokenType;
  text: string;
}

export const SEGMENT_KINDS: ReadonlyArray<{ kind: SegmentKind; label: string; short: string }>;

export function isSegmentKind(kind: unknown): kind is SegmentKind;

export function kindLabel(kind: SegmentKind): string;

export function parseTags(text: string): string[];

export function bareTag(tag: string): string;

export function classifyTag(tag: string): SegmentKind;

export function buildSegments(text: string, idFactory?: (prefix: string) => string): PromptSegment[];

export function segmentText(segment: PromptSegment): string;

export function serializeSegments(segments: PromptSegment[]): string;

export function countTags(segments: PromptSegment[]): number;

export function normalizeSegments(
  input: unknown,
  idFactory?: (prefix: string) => string,
): PromptSegment[];

export function tokenizePrompt(text: string): PromptToken[];

export function segmentTagTexts(segments: PromptSegment[]): string[];
