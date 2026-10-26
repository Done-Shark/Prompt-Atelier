import { FolderTree } from './FolderTree';
import { PromptList } from './PromptList';
import { PromptDetail } from './PromptDetail';
import { PromptEditor } from './PromptEditor';
import { useStore } from '../../app/store';
import './prompts.css';

export function PromptsPage() {
  const { openEditor } = useStore();
  return (
    <div className="workspace">
      <aside className="workspace__panel">
        <FolderTree />
      </aside>
      <section className="workspace__main">
        <PromptList onEdit={openEditor} />
      </section>
      <aside className="workspace__detail">
        <PromptDetail onEdit={openEditor} />
      </aside>
      <PromptEditor />
    </div>
  );
}
