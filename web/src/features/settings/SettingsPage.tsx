import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Languages,
  Palette,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useStore } from '../../app/store';
import { api, downloadUrl, readJsonFile } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { targetPathHint, targetShort } from '../../lib/format';
import type { AppSettings, BackupManifest, Target, ThemeMode, TranslationSettings } from '../../lib/types';
import { Button, ConfirmDialog, Field, IconButton, Segmented, Switch, TextInput } from '../../components/ui';
import { ImportDialog } from '../../components/ImportDialog';
import './settings.css';

type Section = 'appearance' | 'prompts' | 'images' | 'tags' | 'data' | 'about';

const SECTIONS: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'prompts', label: '提示词', icon: Sparkles },
  { id: 'images', label: '图片库', icon: ImageIcon },
  { id: 'tags', label: 'Tag 与翻译', icon: Languages },
  { id: 'data', label: '数据与备份', icon: Database },
  { id: 'about', label: '关于', icon: Info },
];

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '操作失败';
}

export function SettingsPage() {
  const { settings, version, updateSettings, toast, exportPrompts, importPrompts, refresh } = useStore();
  const [section, setSection] = useState<Section>('appearance');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<Target, string>>({ nai: '', comfyui: '' });
  const [importingPrompts, setImportingPrompts] = useState(false);
  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<{ path: string; manifest: BackupManifest } | null>(null);
  const [importSeed, setImportSeed] = useState<{ path: string; target: Target } | null>(null);
  const [translation, setTranslation] = useState<TranslationSettings | null>(null);
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [dictBusy, setDictBusy] = useState(false);
  const dictInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings?.translation) setTranslation(settings.translation);
  }, [settings?.translation]);

  if (!settings) return null;

  const save = async (patch: Partial<AppSettings>, key: string) => {
    setSavingKey(key);
    try {
      await updateSettings(patch);
      toast('设置已保存');
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const addPath = async (target: Target) => {
    const value = draft[target].trim();
    if (!value) return;
    if (settings.scanPaths[target].includes(value)) {
      toast('这个目录已经在列表里', 'error');
      return;
    }
    const next = [...settings.scanPaths[target], value];
    await save({ scanPaths: { ...settings.scanPaths, [target]: next } }, `paths-${target}`);
    setDraft((current) => ({ ...current, [target]: '' }));
  };

  const removePath = async (target: Target, value: string) => {
    const next = settings.scanPaths[target].filter((item) => item !== value);
    await save({ scanPaths: { ...settings.scanPaths, [target]: next } }, `paths-${target}`);
  };

  const browseIntoDraft = async (target: Target) => {
    const bridge = window.atelier;
    if (!bridge) return;
    try {
      const dir = await bridge.chooseDirectory();
      if (dir) setDraft((current) => ({ ...current, [target]: dir }));
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const copyDataDir = async () => {
    try {
      await copyText(settings.dataDir);
      toast('已复制数据目录');
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const openDataDir = async () => {
    const bridge = window.atelier;
    if (!bridge) return;
    try {
      const ok = await bridge.openPath(settings.dataDir);
      if (!ok) toast('无法打开数据目录', 'error');
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const chooseFolder = async (): Promise<string | null> => {
    if (window.atelier?.chooseDirectory) return window.atelier.chooseDirectory();
    const input = window.prompt('输入文件夹的绝对路径');
    return input?.trim() || null;
  };

  const exportBackup = async () => {
    const dir = await chooseFolder();
    if (!dir) return;
    setBackupBusy('export');
    try {
      const result = await api.backup.export({ targetDir: dir });
      toast(`已备份到 ${result.path}`);
      window.atelier?.openPath(result.path);
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setBackupBusy(null);
    }
  };

  const pickRestore = async () => {
    const dir = await chooseFolder();
    if (!dir) return;
    try {
      const info = await api.backup.inspect({ sourceDir: dir });
      setRestoreCandidate({ path: info.path, manifest: info.manifest });
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const confirmRestore = async () => {
    if (!restoreCandidate) return;
    setBackupBusy('restore');
    try {
      const result = await api.backup.restore({ sourceDir: restoreCandidate.path });
      toast(`已恢复 ${result.counts.prompts} 条 Prompt、${result.counts.characters} 张角色卡`);
      setRestoreCandidate(null);
      await refresh();
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setBackupBusy(null);
    }
  };

  const importPromptFile = async (file: File) => {
    setImportingPrompts(true);
    try {
      const data = await readJsonFile(file);
      const result = await importPrompts(data);
      toast(
        result.skipped
          ? `已导入 ${result.imported} 条，跳过 ${result.skipped} 条`
          : `已导入 ${result.imported} 条 Prompt`,
      );
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setImportingPrompts(false);
    }
  };

  const saveTranslation = async () => {
    if (!translation) return;
    setSavingKey('translation');
    try {
      await updateSettings({ translation });
      toast('翻译设置已保存');
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const importDictionaryFile = async (file: File) => {
    setDictBusy(true);
    try {
      const text = await file.text();
      const result = await api.tags.importDictionary({ text });
      toast(
        `词典导入（${result.format}）：更新 ${result.updated} 条，跳过 ${result.skipped} 条${
          result.missing ? `，库中未收录 ${result.missing} 条` : ''
        }`,
      );
      await refresh();
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setDictBusy(false);
      if (dictInputRef.current) dictInputRef.current.value = '';
    }
  };

  const runTagAction = async (mode: 'catalog' | 'translate' | 'danbooru') => {
    setTagBusy(mode);
    try {
      if (mode === 'catalog') {
        const result = await api.tags.syncCatalog();
        toast(`已收录 ${result.added} 个新 tag`);
      } else if (mode === 'translate') {
        const result = await api.tags.translate({ provider: translation?.provider ?? 'dictionary' });
        toast(result.message || `已翻译 ${result.updated} 条`);
      } else {
        const result = await api.tags.sync({});
        toast(result.message || `已同步 ${result.updated} 条分类`);
      }
    } catch (error) {
      toast(messageOf(error), 'error');
    } finally {
      setTagBusy(null);
    }
  };

  const importTagFile = async (file: File) => {
    try {
      const data = await readJsonFile(file);
      const result = await api.tags.importPack(data);
      toast(`已导入 ${result.imported} 条 tag`);
    } catch (error) {
      toast(messageOf(error), 'error');
    }
  };

  const busy = savingKey !== null;

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="设置分类">
        <div className="settings-nav__title">设置</div>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className="settings-nav__item"
              data-active={section === item.id}
              onClick={() => setSection(item.id)}
            >
              <Icon size={15} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="settings-body">
        {section === 'appearance' ? (
          <SettingsCard title="外观" description="主题只影响界面，不改变图片本身。">
            <SettingRow label="主题" description="跟随系统时随操作系统切换深色与浅色。">
              <Segmented
                label="主题"
                value={settings.theme}
                onChange={(value: ThemeMode) => void save({ theme: value }, 'theme')}
                options={[
                  { value: 'dark', label: '深色' },
                  { value: 'light', label: '浅色' },
                  { value: 'system', label: '跟随系统' },
                ]}
              />
            </SettingRow>
            <SettingRow label="减少动效" description="关闭界面里的过渡与淡入。">
              <Switch
                checked={settings.reduceMotion}
                onChange={(checked) => void save({ reduceMotion: checked }, 'reduceMotion')}
                label={settings.reduceMotion ? '已开启' : '已关闭'}
              />
            </SettingRow>
          </SettingsCard>
        ) : null}

        {section === 'prompts' ? (
          <SettingsCard title="提示词" description="新建与复制时的默认行为，改动即时生效。">
            <SettingRow label="新建 Prompt 的默认目标" description="新建时预选 NAI 或 ComfyUI。">
              <Segmented
                label="默认目标"
                value={settings.defaultTarget}
                onChange={(value: Target) => void save({ defaultTarget: value }, 'defaultTarget')}
                options={[
                  { value: 'nai', label: 'NAI' },
                  { value: 'comfyui', label: 'ComfyUI' },
                ]}
              />
            </SettingRow>
            <SettingRow label="复制时附带参数" description="复制 Prompt 时一并输出 Steps、Seed 等参数。">
              <Switch
                checked={settings.copyWithParams}
                onChange={(checked) => void save({ copyWithParams: checked }, 'copyWithParams')}
                label={settings.copyWithParams ? '已开启' : '已关闭'}
              />
            </SettingRow>
            <SettingRow label="导入图片时自动打标签" description="从正向 Prompt 里挑前 3 个具体 tag 作为图片标签。">
              <Switch
                checked={settings.autoTagOnImport}
                onChange={(checked) => void save({ autoTagOnImport: checked }, 'autoTagOnImport')}
                label={settings.autoTagOnImport ? '已开启' : '已关闭'}
              />
            </SettingRow>
          </SettingsCard>
        ) : null}

        {section === 'images' ? (
          <SettingsCard title="图片库" description="NAI 与 ComfyUI 各自独立分区，扫描目录也分开配置。">
            {(['nai', 'comfyui'] as Target[]).map((target) => {
              const paths = settings.scanPaths[target];
              return (
                <div className="settings-dir" key={target}>
                  <div className="settings-dir__head">
                    <span className="settings-dir__title">
                      <span className={`settings-dir__dot settings-dir__dot--${target}`} aria-hidden="true" />
                      {targetShort(target)} 目录
                    </span>
                    <span className="settings-dir__count">{paths.length} 个</span>
                  </div>

                  {paths.length ? (
                    <ul className="settings-dir__list">
                      {paths.map((path) => (
                        <li className="settings-dir__row" key={path}>
                          <span className="settings-dir__path" title={path}>
                            {path}
                          </span>
                          <IconButton label={`扫描 ${path}`} size="sm" onClick={() => setImportSeed({ path, target })}>
                            <ScanLine size={13} />
                          </IconButton>
                          <IconButton label={`移除 ${path}`} size="sm" onClick={() => void removePath(target, path)}>
                            <Trash2 size={13} />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="settings-dir__empty">还没有添加目录。</p>
                  )}

                  <div className="settings-dir__add">
                    <TextInput
                      value={draft[target]}
                      onChange={(event) => setDraft((current) => ({ ...current, [target]: event.target.value }))}
                      placeholder={targetPathHint(target)}
                      aria-label={`${targetShort(target)} 目录路径`}
                      spellCheck={false}
                      disabled={busy}
                    />
                    {window.atelier ? (
                      <Button
                        variant="secondary"
                        icon={<FolderOpen size={13} />}
                        onClick={() => void browseIntoDraft(target)}
                        disabled={busy}
                      >
                        浏览…
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      icon={<Plus size={13} />}
                      onClick={() => void addPath(target)}
                      disabled={busy || !draft[target].trim()}
                    >
                      添加
                    </Button>
                  </div>

                  <div className="settings-dir__foot">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<ScanLine size={13} />}
                      disabled={!paths.length}
                      onClick={() => paths.length && setImportSeed({ path: paths[0], target })}
                    >
                      扫描此目录
                    </Button>
                    <span className="settings-dir__hint">扫描后可预览识别结果再导入</span>
                  </div>
                </div>
              );
            })}
          </SettingsCard>
        ) : null}

        {section === 'tags' && translation ? (
          <>
            <SettingsCard title="翻译来源" description="内置词典离线可用；AI 翻译支持 OpenAI 兼容接口与 Gemini 原生接口。">
              <SettingRow label="翻译方式" description="人工修正过的 tag 不会被自动覆盖。">
                <Segmented
                  label="翻译方式"
                  value={translation.provider}
                  onChange={(value) => {
                    setTranslation({ ...translation, provider: value });
                    void save({ translation: { ...translation, provider: value } }, 'translation-provider');
                  }}
                  options={[
                    { value: 'dictionary', label: '内置词典' },
                    { value: 'llm', label: 'OpenAI 兼容' },
                    { value: 'gemini', label: 'Gemini' },
                  ]}
                />
              </SettingRow>

              {translation.provider !== 'dictionary' ? (
                <div className="settings-form">
                  <Field
                    label="接口地址"
                    hint={
                      translation.provider === 'gemini'
                        ? 'Gemini 原生地址；留空使用官方地址，也可填反向代理。'
                        : 'OpenAI 兼容的 /v1 地址，本地 localhost 可用 HTTP。'
                    }
                  >
                    <TextInput
                      value={translation.baseUrl}
                      placeholder={
                        translation.provider === 'gemini'
                          ? 'https://generativelanguage.googleapis.com/v1beta'
                          : 'http://127.0.0.1:11434/v1'
                      }
                      mono
                      onChange={(event) => setTranslation({ ...translation, baseUrl: event.target.value })}
                    />
                  </Field>
                  <div className="settings-form__row">
                    <Field
                      label="模型名称"
                      hint={translation.provider === 'gemini' ? '留空使用 gemini-2.5-flash。' : undefined}
                    >
                      <TextInput
                        value={translation.model}
                        placeholder={translation.provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen2.5:7b'}
                        onChange={(event) => setTranslation({ ...translation, model: event.target.value })}
                      />
                    </Field>
                    <Field
                      label="API Key"
                      hint={translation.provider === 'gemini' ? '必填，Google AI Studio 生成的 Key。' : '本地服务通常留空。'}
                    >
                      <TextInput
                        type="password"
                        value={translation.apiKey}
                        placeholder={translation.provider === 'gemini' ? 'AIza...' : 'sk-...'}
                        onChange={(event) => setTranslation({ ...translation, apiKey: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="settings-form__actions">
                    <Button variant="primary" loading={savingKey === 'translation'} onClick={() => void saveTranslation()}>
                      {translation.provider === 'gemini' ? '保存 Gemini 设置' : '保存模型设置'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="settings-note">
                  内置词典覆盖常见画师、人物、外貌、服装、动作、表情、背景与构图 tag。未收录的条目可以切换到 AI 翻译补齐，或手动填写。
                </p>
              )}

              <SettingRow label="导入后自动翻译" description="新收录的 tag 自动尝试翻译一次。">
                <Switch
                  checked={translation.autoTranslateOnImport}
                  onChange={(checked) => {
                    const next = { ...translation, autoTranslateOnImport: checked };
                    setTranslation(next);
                    void save({ translation: next }, 'translation-auto');
                  }}
                  label={translation.autoTranslateOnImport ? '已开启' : '已关闭'}
                />
              </SettingRow>
              <SettingRow label="允许 Danbooru 查询" description="同步分类与热度；只发送 tag 文本，不发送图片。">
                <Switch
                  checked={translation.danbooruEnabled}
                  onChange={(checked) => {
                    const next = { ...translation, danbooruEnabled: checked };
                    setTranslation(next);
                    void save({ translation: next }, 'translation-danbooru');
                  }}
                  label={translation.danbooruEnabled ? '已开启' : '已关闭'}
                />
              </SettingRow>
            </SettingsCard>

            <SettingsCard title="批量处理" description="已修正的条目默认跳过，需要覆盖时可在 Tag 库中取消锁定。">
              <div className="settings-actions">
                <Button
                  variant="secondary"
                  icon={<Sparkles size={13} />}
                  loading={tagBusy === 'catalog'}
                  onClick={() => void runTagAction('catalog')}
                >
                  收录 Prompt 里的新 tag
                </Button>
                <Button
                  variant="secondary"
                  icon={<Languages size={13} />}
                  loading={tagBusy === 'translate'}
                  onClick={() => void runTagAction('translate')}
                >
                  翻译待处理条目
                </Button>
                <Button
                  variant="secondary"
                  icon={<Database size={13} />}
                  loading={tagBusy === 'danbooru'}
                  onClick={() => void runTagAction('danbooru')}
                  disabled={!translation.danbooruEnabled}
                >
                  同步 Danbooru 分类
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard title="外部词典" description="把 ffdkj / DSO 等现成词典并进 Tag 库，只补空，不覆盖人工修正。">
              <SettingRow
                label="导入 JSON 词典"
                description="支持 {tag: 中文} 映射、本项目导出包、NAI Launcher zh_translations、DSO dso-dictionary。"
              >
                <Button
                  variant="secondary"
                  icon={<Upload size={13} />}
                  loading={dictBusy}
                  onClick={() => dictInputRef.current?.click()}
                >
                  选择文件
                </Button>
                <input
                  ref={dictInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importDictionaryFile(file);
                  }}
                />
              </SettingRow>
              <p className="settings-note">
                ffdkj 的 tag.sqlite（约 22 MB，32 万条）走命令行：<code>npm run import:dict</code>，加{' '}
                <code>--overwrite</code> 覆盖已有翻译、<code>--all</code> 把未收录的 tag 也写进库。
              </p>
            </SettingsCard>
          </>
        ) : null}

        {section === 'data' ? (
          <>
            <SettingsCard title="数据位置" description="所有数据保存在本机，不经过网络。">
              <SettingRow label="数据目录" description="Prompt、图片副本与索引的存放位置。" align="start">
                <div className="settings-data-row">
                  <TextInput value={settings.dataDir} readOnly aria-label="数据目录" mono />
                  <IconButton label="复制数据目录" onClick={() => void copyDataDir()}>
                    <Copy size={13} />
                  </IconButton>
                  {window.atelier ? (
                    <Button variant="secondary" icon={<ExternalLink size={13} />} onClick={() => void openDataDir()}>
                      打开
                    </Button>
                  ) : null}
                </div>
              </SettingRow>
            </SettingsCard>

            <SettingsCard
              title="整库备份"
              description="包含 Prompt、图片原图、Tag、文件夹、相册与 RP 角色卡；不包含 API Key。"
            >
              <SettingRow
                label="备份到文件夹"
                description="会新建 PromptAtelier-backup-<时间> 目录，内含 data.json、images 与 thumbs。"
              >
                <Button
                  variant="secondary"
                  icon={<Download size={13} />}
                  loading={backupBusy === 'export'}
                  onClick={() => void exportBackup()}
                >
                  选择文件夹
                </Button>
              </SettingRow>
              <SettingRow
                label="从备份恢复"
                description="覆盖当前数据；恢复前会自动把当前 data.json 另存到 data/backups。"
              >
                <Button
                  variant="secondary"
                  icon={<Upload size={13} />}
                  loading={backupBusy === 'restore'}
                  onClick={() => void pickRestore()}
                >
                  选择备份目录
                </Button>
              </SettingRow>
            </SettingsCard>

            <SettingsCard title="备份与恢复" description="导出的 JSON 可以在另一台机器上导入。">
              <SettingRow label="导出全部 Prompt" description="生成一份可再次导入的 JSON 备份。">
                <Button variant="secondary" icon={<Download size={13} />} onClick={exportPrompts}>
                  导出
                </Button>
              </SettingRow>
              <SettingRow label="导入 Prompt" description="支持本应用导出的备份文件。">
                <>
                  <Button
                    variant="secondary"
                    icon={<Upload size={13} />}
                    loading={importingPrompts}
                    onClick={() => promptInputRef.current?.click()}
                  >
                    选择文件
                  </Button>
                  <input
                    ref={promptInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void importPromptFile(file);
                    }}
                  />
                </>
              </SettingRow>
              <SettingRow label="Tag 库" description="导出分类与翻译，或导入别人整理好的词典。">
                <div className="settings-actions">
                  <Button
                    variant="secondary"
                    icon={<Download size={13} />}
                    onClick={() => downloadUrl(api.tags.exportUrl(), 'tag-library.json')}
                  >
                    导出
                  </Button>
                  <Button variant="secondary" icon={<Upload size={13} />} onClick={() => tagInputRef.current?.click()}>
                    导入
                  </Button>
                  <input
                    ref={tagInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void importTagFile(file);
                    }}
                  />
                </div>
              </SettingRow>
            </SettingsCard>
          </>
        ) : null}

        {section === 'about' ? (
          <SettingsCard title="关于" description="Prompt Atelier · 本地优先的 Prompt 工作台。">
            <div className="settings-about">
              <div className="settings-about__row">
                <span>版本</span>
                <span className="mono">v{version}</span>
              </div>
              <div className="settings-about__row">
                <span>技术栈</span>
                <span>Electron + React + Node</span>
              </div>
              <div className="settings-about__row">
                <span>数据</span>
                <span>全部保存在本机，无账号、无云端</span>
              </div>
              <div className="settings-about__row settings-about__row--stack">
                <span>参考项目</span>
                <span className="settings-credits">
                  <span>Aaalice_NAI_Launcher</span>
                  <span>NovelAIPromptStudio</span>
                  <span>ComfyUI-Lora-Manager</span>
                </span>
              </div>
            </div>
          </SettingsCard>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(restoreCandidate)}
        title="从备份恢复"
        message={
          restoreCandidate
            ? `将用 ${restoreCandidate.manifest.exportedAt.slice(0, 10)} 的备份覆盖当前数据：${
                restoreCandidate.manifest.counts.prompts
              } 条 Prompt、${restoreCandidate.manifest.counts.images} 张图片、${
                restoreCandidate.manifest.counts.characters
              } 张角色卡。恢复前会自动备份当前 data.json。`
            : ''
        }
        confirmLabel="恢复"
        danger
        loading={backupBusy === 'restore'}
        onCancel={() => setRestoreCandidate(null)}
        onConfirm={confirmRestore}
      />

      <ImportDialog
        open={Boolean(importSeed)}
        initialPath={importSeed?.path}
        initialTarget={importSeed?.target}
        onClose={() => setImportSeed(null)}
        onImported={() => void refresh()}
      />
    </div>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-card">
      <header className="settings-card__head">
        <h2 className="settings-card__title">{title}</h2>
        {description ? <p className="settings-card__desc">{description}</p> : null}
      </header>
      <div className="settings-card__body">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  align = 'center',
  children,
}: {
  label: string;
  description?: string;
  align?: 'center' | 'start';
  children: ReactNode;
}) {
  return (
    <div className="settings-row" data-align={align}>
      <div className="settings-row__text">
        <span className="settings-row__label">{label}</span>
        {description ? <span className="settings-row__desc">{description}</span> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}
