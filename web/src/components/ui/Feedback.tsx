import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spinner ${className}`.trim()} role="status" aria-label="加载中" />;
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

export function ToastViewport({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'toast--error' : ''}`.trim()}>
          {toast.tone === 'error' ? (
            <AlertCircle size={14} className="toast__icon toast__icon--error" />
          ) : (
            <CheckCircle2 size={14} className="toast__icon toast__icon--ok" />
          )}
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
