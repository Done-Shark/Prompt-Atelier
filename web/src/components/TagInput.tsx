import { useState } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  id?: string;
}

/** 轻量标签输入：回车添加，逗号也可分隔，退格删除最后一个 */
export function TagInput({ value, onChange, placeholder = '添加标签，回车确认', id }: TagInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parts = draft
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (!next.includes(part)) next.push(part);
    }
    onChange(next);
    setDraft('');
  };

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span className="chip" key={tag}>
          <span className="chip__text">{tag}</span>
          <button
            type="button"
            className="chip__x"
            aria-label={`移除标签 ${tag}`}
            onClick={() => onChange(value.filter((item) => item !== tag))}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="tag-input__field"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}
