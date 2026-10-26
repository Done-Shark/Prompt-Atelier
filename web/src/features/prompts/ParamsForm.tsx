import { Plus, Trash2 } from 'lucide-react';
import type { ComfyLora, ComfyParams, NaiParams, PromptParams, Target } from '../../lib/types';
import { Button, Field, IconButton, NumberField, Select, TextInput, Switch } from '../../components/ui';

const NAI_MODELS = [
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5 Full' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated' },
  { value: 'nai-diffusion-4-full', label: 'NAI Diffusion V4 Full' },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion V4 Curated' },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion V3' },
];

const NAI_SAMPLERS = [
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim', label: 'DDIM' },
];

const UC_PRESETS = [
  { value: '0', label: 'Heavy' },
  { value: '1', label: 'Light' },
  { value: '2', label: 'None' },
  { value: '3', label: 'Human Focus' },
];

const COMFY_SAMPLERS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'ddim', 'uni_pc', 'lcm'];
const COMFY_SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta'];

interface ParamsFormProps {
  target: Target;
  value: PromptParams;
  onChange: (next: PromptParams) => void;
}

export function ParamsForm({ target, value, onChange }: ParamsFormProps) {
  if (target === 'nai') {
    return <NaiParamsForm value={value as NaiParams} onChange={onChange} />;
  }
  return <ComfyParamsForm value={value as ComfyParams} onChange={onChange} />;
}

function NaiParamsForm({ value, onChange }: { value: NaiParams; onChange: (next: NaiParams) => void }) {
  const patch = (part: Partial<NaiParams>) => onChange({ ...value, ...part });

  return (
    <div className="param-form">
      <div className="param-grid">
        <Field label="模型" className="param-grid__wide">
          <Select
            value={value.model}
            options={NAI_MODELS}
            onChange={(event) => patch({ model: event.target.value })}
          />
        </Field>
        <Field label="采样器">
          <Select
            value={value.sampler}
            options={NAI_SAMPLERS}
            onChange={(event) => patch({ sampler: event.target.value })}
          />
        </Field>
        <Field label="UC Preset">
          <Select
            value={String(value.ucPreset)}
            options={UC_PRESETS}
            onChange={(event) => patch({ ucPreset: Number(event.target.value) })}
          />
        </Field>
        <Field label="Steps">
          <NumberField value={value.steps} min={1} max={150} onChange={(steps) => patch({ steps })} />
        </Field>
        <Field label="CFG Scale">
          <NumberField value={value.scale} min={0} max={20} step={0.5} onChange={(scale) => patch({ scale })} />
        </Field>
        <Field label="CFG Rescale">
          <NumberField
            value={value.cfgRescale}
            min={0}
            max={1}
            step={0.05}
            onChange={(cfgRescale) => patch({ cfgRescale })}
          />
        </Field>
        <Field label="Seed">
          <NumberField
            value={value.seed}
            min={0}
            max={4_294_967_295}
            onChange={(seed) => patch({ seed })}
          />
        </Field>
        <Field label="宽">
          <NumberField value={value.width} min={64} max={4096} step={64} onChange={(width) => patch({ width })} />
        </Field>
        <Field label="高">
          <NumberField value={value.height} min={64} max={4096} step={64} onChange={(height) => patch({ height })} />
        </Field>
      </div>
      <div className="param-toggles">
        <Switch checked={value.qualityToggle} onChange={(qualityToggle) => patch({ qualityToggle })} label="质量提示词" />
        <Switch checked={value.variety} onChange={(variety) => patch({ variety })} label="Variety+" />
      </div>
    </div>
  );
}

function ComfyParamsForm({ value, onChange }: { value: ComfyParams; onChange: (next: ComfyParams) => void }) {
  const patch = (part: Partial<ComfyParams>) => onChange({ ...value, ...part });
  const loras = value.loras ?? [];

  const updateLora = (index: number, part: Partial<ComfyLora>) => {
    patch({ loras: loras.map((item, i) => (i === index ? { ...item, ...part } : item)) });
  };

  return (
    <div className="param-form">
      <div className="param-grid">
        <Field label="Checkpoint" className="param-grid__wide">
          <TextInput
            value={value.checkpoint}
            placeholder="例如 flux1-dev.safetensors"
            onChange={(event) => patch({ checkpoint: event.target.value })}
          />
        </Field>
        <Field label="采样器">
          <Select
            value={value.sampler}
            options={COMFY_SAMPLERS.map((item) => ({ value: item, label: item }))}
            onChange={(event) => patch({ sampler: event.target.value })}
          />
        </Field>
        <Field label="调度器">
          <Select
            value={value.scheduler}
            options={COMFY_SCHEDULERS.map((item) => ({ value: item, label: item }))}
            onChange={(event) => patch({ scheduler: event.target.value })}
          />
        </Field>
        <Field label="Steps">
          <NumberField value={value.steps} min={1} max={150} onChange={(steps) => patch({ steps })} />
        </Field>
        <Field label="CFG">
          <NumberField value={value.cfg} min={0} max={30} step={0.5} onChange={(cfg) => patch({ cfg })} />
        </Field>
        <Field label="Seed">
          <NumberField value={value.seed} min={0} max={4_294_967_295} onChange={(seed) => patch({ seed })} />
        </Field>
        <Field label="Batch">
          <NumberField value={value.batch} min={1} max={64} onChange={(batch) => patch({ batch })} />
        </Field>
        <Field label="宽">
          <NumberField value={value.width} min={64} max={4096} step={64} onChange={(width) => patch({ width })} />
        </Field>
        <Field label="高">
          <NumberField value={value.height} min={64} max={4096} step={64} onChange={(height) => patch({ height })} />
        </Field>
      </div>

      <div className="lora-list">
        <div className="lora-list__head">
          <span className="section__title">LoRA</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} />}
            onClick={() => patch({ loras: [...loras, { name: '', strength: 1, clipStrength: 1 }] })}
          >
            添加
          </Button>
        </div>
        {loras.length === 0 ? (
          <p className="field__hint">没有 LoRA。添加后会以 &lt;lora:name:weight&gt; 追加到正向 Prompt。</p>
        ) : (
          loras.map((lora, index) => (
            <div className="lora-row" key={`${lora.name}-${index}`}>
              <TextInput
                value={lora.name}
                placeholder="lora 文件名"
                aria-label="LoRA 名称"
                onChange={(event) => updateLora(index, { name: event.target.value })}
              />
              <NumberField
                value={lora.strength}
                min={-5}
                max={5}
                step={0.05}
                onChange={(strength) => updateLora(index, { strength })}
              />
              <NumberField
                value={lora.clipStrength}
                min={-5}
                max={5}
                step={0.05}
                onChange={(clipStrength) => updateLora(index, { clipStrength })}
              />
              <IconButton
                label="删除这条 LoRA"
                size="sm"
                onClick={() => patch({ loras: loras.filter((_, i) => i !== index) })}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
