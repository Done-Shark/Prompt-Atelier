import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface ThumbSource {
  thumb: (id: string) => string;
  file: (id: string) => string;
  save: (id: string, data: string) => Promise<unknown>;
}

interface ThumbImageProps {
  id: string;
  alt: string;
  className?: string;
  onReady?: () => void;
  /** 默认走图片库；RP 角色卡传自己的 source */
  source?: ThumbSource;
}

const IMAGE_SOURCE: ThumbSource = {
  thumb: (id) => api.images.thumbUrl(id),
  file: (id) => api.images.fileUrl(id),
  save: (id, data) => api.images.saveThumb(id, data),
};

const MAX_EDGE = 480;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('缩略图编码失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 缩略图：优先读服务端缓存（<data>/thumbs/<hash>.webp）。
 * 首次访问 404 时，用原图在浏览器里生成 480px WebP 并回传缓存，后续直接命中。
 */
export function ThumbImage({ id, alt, className, onReady, source = IMAGE_SOURCE }: ThumbImageProps) {
  const [src, setSrc] = useState(() => source.thumb(id));
  const [loaded, setLoaded] = useState(false);
  const generating = useRef(false);
  const failed = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const previousId = useRef(id);

  useEffect(() => {
    if (previousId.current === id) return;
    previousId.current = id;
    setSrc(source.thumb(id));
    setLoaded(false);
    generating.current = false;
    failed.current = false;
  }, [id, source]);

  // 缓存命中时 onLoad 可能在 effect 之前就触发，这里补一次完成检查
  useEffect(() => {
    const image = imgRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const generate = async () => {
    if (generating.current || failed.current) return;
    generating.current = true;
    try {
      const original = source.file(id);
      const image = await loadImage(original);
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建画布');
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (!blob) throw new Error('缩略图生成失败');
      await source.save(id, await blobToBase64(blob));
      setSrc(`${source.thumb(id)}?v=${Date.now()}`);
    } catch {
      failed.current = true;
      setSrc(source.file(id));
    } finally {
      generating.current = false;
    }
  };

  return (
    <img
      ref={imgRef}
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-loaded={loaded}
      onLoad={() => {
        setLoaded(true);
        onReady?.();
      }}
      onError={() => {
        if (failed.current) {
          onReady?.();
          return;
        }
        void generate();
      }}
    />
  );
}
