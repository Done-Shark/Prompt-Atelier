/** 复制到剪贴板；Electron 与浏览器共用。失败时抛出可读错误。 */
export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error('没有可复制的内容');
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 某些环境下没有剪贴板权限，退回 execCommand
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('复制失败，请手动选择文本');
  }
}
