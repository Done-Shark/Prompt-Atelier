import { tokenizePrompt } from '../../../shared/prompt/doc.js';
import './PromptText.css';

interface PromptTextProps {
  text: string;
  className?: string;
  /** 行数上限，超出显示省略号（详情页用） */
  clamp?: number;
}

/** 只读的 Prompt 文本，带权重 / LoRA / 分隔符着色 */
export function PromptText({ text, className = '', clamp }: PromptTextProps) {
  const tokens = tokenizePrompt(text);
  return (
    <span
      className={`prompt-text ${className}`.trim()}
      style={clamp ? { WebkitLineClamp: clamp } : undefined}
      data-clamp={clamp ? 'true' : undefined}
    >
      {tokens.map((token, index) => (
        <span key={`${token.type}-${index}`} className={`pt pt--${token.type}`}>
          {token.text}
        </span>
      ))}
    </span>
  );
}
