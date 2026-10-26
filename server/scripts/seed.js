/**
 * 演示数据脚本：node server/scripts/seed.js [--force]
 *
 * 做三件事：
 * 1. 写入 8 条 Prompt（5 NAI / 3 ComfyUI）、提示词/图片文件夹、标签、相簿与收藏；
 * 2. 程序化生成 6 张真实 PNG（3 张 NAI Comment / 3 张 ComfyUI prompt），
 *    再走正式导入管线写入图片索引；
 * 3. 收录 Tag 并用内置词典补一轮翻译。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDb } from '../store/db.js';
import { pathExists } from '../lib/fsx.js';
import { encodePng } from '../media/pngEncode.js';
import { create as createFolder } from '../modules/folders/service.js';
import { create as createPrompt } from '../modules/prompts/service.js';
import { importImages, update as updateImage } from '../modules/images/service.js';
import { relayout } from '../modules/storage/layout.js';
import * as tagsService from '../modules/tags/service.js';
import { create as createAlbum, membership as albumMembership } from '../modules/albums/service.js';

const force = process.argv.includes('--force');
const config = loadConfig();

async function hasExistingData() {
  if (!(await pathExists(config.sqliteFile)) && !(await pathExists(config.dbFile))) return false;
  try {
    const probe = await openDb(config);
    const snap = probe.snapshot();
    probe.close();
    return snap.prompts.length > 0 || snap.images.length > 0 || snap.albums.length > 0;
  } catch {
    return false;
  }
}

if (await hasExistingData()) {
  if (!force) {
    console.log('检测到已有数据，未做任何改动。');
    console.log('如需覆盖演示数据，请运行：node server/scripts/seed.js --force');
    process.exit(1);
  }
  await fs.rm(config.sqliteFile, { force: true });
  await fs.rm(`${config.sqliteFile}-wal`, { force: true });
  await fs.rm(`${config.sqliteFile}-shm`, { force: true });
  await fs.rm(config.dbFile, { force: true });
  await fs.rm(config.imagesDir, { recursive: true, force: true });
  await fs.rm(config.thumbsDir, { recursive: true, force: true });
  console.log('已清空旧数据（--force）。');
}

const db = await openDb(config);

/* ------------------------------ 文件夹 ------------------------------ */

const folderChars = await createFolder(db, { name: '角色', target: 'nai' });
const folderScenes = await createFolder(db, { name: '场景', target: 'all' });
const folderWorkflow = await createFolder(db, { name: '工作流', target: 'comfyui' });

// 图片库按目标格式各自独立的文件夹树
const naiImageScenes = await createFolder(db, { name: '场景', target: 'nai', scope: 'image' });
const naiImageChars = await createFolder(db, { name: '角色', target: 'nai', scope: 'image' });
const comfyImageScenes = await createFolder(db, { name: '场景', target: 'comfyui', scope: 'image' });
const comfyImageChars = await createFolder(db, { name: '角色', target: 'comfyui', scope: 'image' });

/* ------------------------------ Prompts ----------------------------- */

const promptSeeds = [
  {
    title: '黄昏电车',
    target: 'nai',
    positive:
      'artist:ciloranko, 1girl, solo, looking at viewer, {sunset}, {{city lights}}, depth of field, (cinematic lighting:1.2)',
    negative: 'lowres, bad anatomy, worst quality, text, watermark, signature',
    tags: ['场景', '黄昏'],
    folderId: folderScenes.id,
    favorite: true,
    notes: '逆光 + 电车顶灯，权重用来压住画面噪点。',
    params: {
      model: 'nai-diffusion-4-5-full',
      sampler: 'k_euler_ancestral',
      steps: 28,
      scale: 5,
      seed: 1234567890,
      width: 832,
      height: 1216,
    },
  },
  {
    title: '雨夜霓虹',
    target: 'nai',
    positive: 'artist:ask, 1girl, solo, (jacket:0.8), rain, wet street, cyberpunk city, city lights, from behind',
    negative: 'lowres, bad hands, extra fingers, jpeg artifacts',
    tags: ['场景', '赛博'],
    folderId: folderScenes.id,
    params: { steps: 32, scale: 6, seed: 987654321, width: 832, height: 1216 },
  },
  {
    title: '银发少女',
    target: 'nai',
    positive: 'artist:wlop, 1girl, solo, silver hair, {long hair}, blue eyes, school uniform, upper body, soft lighting',
    negative: 'lowres, bad anatomy, extra digits, blurry',
    tags: ['角色', '银发'],
    folderId: folderChars.id,
    favorite: true,
    params: { steps: 24, scale: 4.5, seed: 555000111, width: 832, height: 1216 },
  },
  {
    title: '森林晨雾',
    target: 'nai',
    positive: 'artist:atdan, forest, landscape, {{morning mist}}, sunbeams, (volumetric lighting:1.1)',
    negative: 'lowres, text, watermark, oversaturated',
    tags: ['场景', '自然'],
    folderId: folderScenes.id,
    params: { steps: 30, scale: 5.5, seed: 42, width: 1216, height: 832 },
  },
  {
    title: '机甲少女',
    target: 'nai',
    positive: 'artist:modare, 1girl, solo, mecha pilot suit, {armor}, sci-fi background, dynamic pose, (glowing visor:1.3)',
    negative: 'lowres, bad proportions, deformed, watermark',
    tags: ['角色', '机甲'],
    folderId: folderChars.id,
    params: { steps: 28, scale: 7, seed: 777888999, width: 832, height: 1216 },
  },
  {
    title: '赛博街景',
    target: 'comfyui',
    positive:
      'cyberpunk street at night, rain, cinematic composition, highly detailed, 8k, (masterpiece:1.2), neon reflections',
    negative: 'lowres, blurry, bad perspective, text, watermark',
    tags: ['场景', '赛博'],
    folderId: folderWorkflow.id,
    favorite: true,
    notes: 'ComfyUI 工作流：illustrious + 风格 LoRA。',
    params: {
      checkpoint: 'illustrious_v1.safetensors',
      loras: [{ name: 'cyberpunk_style.safetensors', strength: 0.8, clipStrength: 0.7 }],
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      steps: 28,
      cfg: 7.5,
      seed: 20240101,
      width: 832,
      height: 1216,
    },
  },
  {
    title: '像素角色',
    target: 'comfyui',
    positive: 'transparent background, from front, pixel art, 16-bit, knight character, sharp pixels',
    negative: 'blurry, anti-aliasing, jpeg artifacts',
    tags: ['角色', '像素'],
    folderId: folderChars.id,
    params: {
      checkpoint: 'pixelArt_v2.safetensors',
      loras: [
        { name: 'pixel_detail.safetensors', strength: 1, clipStrength: 1 },
        { name: 'knight_gear.safetensors', strength: 0.6, clipStrength: 0.5 },
      ],
      sampler: 'euler',
      scheduler: 'normal',
      steps: 24,
      cfg: 6,
      seed: 31415926,
      width: 1024,
      height: 1024,
    },
  },
  {
    title: '产品摄影',
    target: 'comfyui',
    positive: 'minimal background, product photo of a ceramic cup, studio lighting, high detail',
    negative: 'shadow artifacts, lowres, text',
    tags: ['产品'],
    folderId: folderWorkflow.id,
    params: {
      checkpoint: 'sd_xl_base_1.0.safetensors',
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      steps: 30,
      cfg: 5,
      seed: 8888,
      width: 1024,
      height: 1024,
    },
  },
];

for (const seed of promptSeeds) {
  await createPrompt(db, { ...seed, origin: 'manual' });
}

/* --------------------------- PNG 生成 ------------------------------- */

function naiComment({ prompt, negative, seed, steps, scale, width, height, chars = [] }) {
  return JSON.stringify({
    prompt,
    uc: negative,
    steps,
    scale,
    seed,
    sampler: 'k_euler_ancestral',
    noise_schedule: 'karras',
    width,
    height,
    model: 'nai-diffusion-4-5-full',
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    sm: false,
    sm_dyn: false,
    v4_prompt: {
      caption: { base_caption: prompt, char_captions: chars },
      use_coords: chars.length > 0,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: negative, char_captions: [] },
    },
  });
}

function comfyGraph({ positive, negative, seed, steps, cfg, sampler, scheduler, width, height, checkpoint, loras = [] }) {
  const graph = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    5: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    8: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 2] } },
    10: { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'ComfyUI' } },
  };

  let modelLink = ['4', 0];
  loras.forEach((lora, index) => {
    const id = String(20 + index);
    graph[id] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength,
        strength_clip: lora.clipStrength,
        model: modelLink,
        clip: ['4', 1],
      },
    };
    modelLink = [id, 0];
  });
  graph[8].inputs.model = modelLink;
  return JSON.stringify(graph);
}

function gradientPng(width, height, from, to, textChunks) {
  return encodePng({
    width,
    height,
    textChunks,
    pixel: (x, y) => {
      const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
      return [
        Math.round(from[0] + (to[0] - from[0]) * t),
        Math.round(from[1] + (to[1] - from[1]) * t),
        Math.round(from[2] + (to[2] - from[2]) * t),
      ];
    },
  });
}

const imageSeeds = [
  {
    fileName: 'nai_sunset_train.png',
    target: 'nai',
    from: [250, 170, 110],
    to: [70, 60, 120],
    comment: naiComment({
      prompt: promptSeeds[0].positive,
      negative: promptSeeds[0].negative,
      seed: 1234567890,
      steps: 28,
      scale: 5,
      width: 512,
      height: 768,
    }),
  },
  {
    fileName: 'nai_silver_hair.png',
    target: 'nai',
    from: [210, 220, 240],
    to: [120, 140, 190],
    comment: naiComment({
      prompt: promptSeeds[2].positive,
      negative: promptSeeds[2].negative,
      seed: 555000111,
      steps: 24,
      scale: 4.5,
      width: 512,
      height: 768,
      chars: [
        {
          char_caption: '1girl, silver hair, blue eyes',
          centers: [{ x: 0.5, y: 0.4 }],
        },
      ],
    }),
  },
  {
    fileName: 'nai_mecha.png',
    target: 'nai',
    from: [90, 110, 140],
    to: [220, 80, 60],
    comment: naiComment({
      prompt: promptSeeds[4].positive,
      negative: promptSeeds[4].negative,
      seed: 777888999,
      steps: 28,
      scale: 7,
      width: 512,
      height: 768,
    }),
  },
  {
    fileName: 'comfy_cyber_street.png',
    target: 'comfyui',
    from: [30, 40, 90],
    to: [200, 40, 160],
    prompt: comfyGraph({
      positive: promptSeeds[5].positive,
      negative: promptSeeds[5].negative,
      seed: 20240101,
      steps: 28,
      cfg: 7.5,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      width: 512,
      height: 768,
      checkpoint: 'illustrious_v1.safetensors',
      loras: [{ name: 'cyberpunk_style.safetensors', strength: 0.8, clipStrength: 0.7 }],
    }),
  },
  {
    fileName: 'comfy_pixel_knight.png',
    target: 'comfyui',
    from: [40, 120, 80],
    to: [240, 220, 120],
    prompt: comfyGraph({
      positive: promptSeeds[6].positive,
      negative: promptSeeds[6].negative,
      seed: 31415926,
      steps: 24,
      cfg: 6,
      sampler: 'euler',
      scheduler: 'normal',
      width: 512,
      height: 512,
      checkpoint: 'pixelArt_v2.safetensors',
      loras: [
        { name: 'pixel_detail.safetensors', strength: 1, clipStrength: 1 },
        { name: 'knight_gear.safetensors', strength: 0.6, clipStrength: 0.5 },
      ],
    }),
  },
  {
    fileName: 'comfy_product_cup.png',
    target: 'comfyui',
    from: [245, 240, 230],
    to: [180, 170, 155],
    prompt: comfyGraph({
      positive: promptSeeds[7].positive,
      negative: promptSeeds[7].negative,
      seed: 8888,
      steps: 30,
      cfg: 5,
      sampler: 'dpmpp_2m_sde',
      scheduler: 'karras',
      width: 512,
      height: 512,
      checkpoint: 'sd_xl_base_1.0.safetensors',
    }),
  },
];

const stagingDir = path.join(config.dataDir, '.seed-images');
await fs.rm(stagingDir, { recursive: true, force: true });
await fs.mkdir(stagingDir, { recursive: true });

for (const seed of imageSeeds) {
  const textChunks =
    seed.target === 'nai'
      ? [{ key: 'Comment', value: seed.comment }]
      : [
          { key: 'prompt', value: seed.prompt },
          { key: 'workflow', value: JSON.stringify({ nodes: [], links: [] }) },
        ];
  const png = gradientPng(512, seed.target === 'nai' ? 768 : 512, seed.from, seed.to, textChunks);
  await fs.writeFile(path.join(stagingDir, seed.fileName), png);
}

const result = await importImages({ db, config }, { path: stagingDir, recursive: false, target: 'auto' });
await fs.rm(stagingDir, { recursive: true, force: true });

// 给部分图片补收藏 / 文件夹 / 标签，让图片库两个分区都有可展示内容
const byName = new Map(result.imported.map((image) => [image.fileName, image]));
const imageTweaks = [
  { name: 'nai_sunset_train.png', folderId: naiImageScenes.id, tags: ['场景', '黄昏'], favorite: true },
  { name: 'nai_silver_hair.png', folderId: naiImageChars.id, tags: ['角色', '银发'], favorite: true },
  { name: 'comfy_cyber_street.png', folderId: comfyImageScenes.id, tags: ['场景', '赛博'], favorite: true },
  { name: 'comfy_pixel_knight.png', folderId: comfyImageChars.id, tags: ['角色', '像素'], favorite: false },
];
for (const tweak of imageTweaks) {
  const image = byName.get(tweak.name);
  if (!image) continue;
  await updateImage({ db, config }, image.id, {
    folderId: tweak.folderId,
    tags: tweak.tags,
    favorite: tweak.favorite,
  });
}

// Tag 库：把 Prompt 里的 tag 收进目录，并用内置词典补一轮翻译
await tagsService.syncCatalog(db);
await tagsService.translate({ db }, { provider: 'dictionary' });

// 相簿：演示多对多集合（收藏是系统相簿，不需要创建）
const albumFeatured = await createAlbum(db, { name: '精选' });
const albumRef = await createAlbum(db, { name: '待参考' });
const albumImages = snapshotImagesForAlbums();
await albumMembership({ db }, albumFeatured.id, { ids: albumImages.slice(0, 3), action: 'add' });
await albumMembership({ db }, albumRef.id, { ids: albumImages.slice(1, 4), action: 'add' });

function snapshotImagesForAlbums() {
  return db.snapshot().images.map((image) => image.id);
}

// 种子数据也按镜像布局落盘（与首次启动时的迁移保持一致）
const layout = await relayout({ db, config });

const snapshot = db.snapshot();
console.log('演示数据已写入：');
console.log(`  Prompt：${snapshot.prompts.length} 条（NAI ${snapshot.prompts.filter((p) => p.target === 'nai').length} / ComfyUI ${snapshot.prompts.filter((p) => p.target === 'comfyui').length}）`);
console.log(`  文件夹：${snapshot.folders.length} 个`);
console.log(`  图片：${snapshot.images.length} 张（NAI ${snapshot.images.filter((i) => i.target === 'nai').length} / ComfyUI ${snapshot.images.filter((i) => i.target === 'comfyui').length}）`);
console.log(`  Tag：${snapshot.tags.length} 条（已翻译 ${snapshot.tags.filter((t) => t.translation).length}）`);
console.log(`  相簿：${snapshot.albums.length} 个`);
if (result.skipped.length) console.log(`  跳过：${result.skipped.length} 项`);
if (layout.moved) console.log(`  已按文件夹结构整理 ${layout.moved} 个文件`);
console.log(`数据目录：${config.dataDir}`);
