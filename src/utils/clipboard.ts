/**
 * 复制文本到剪贴板。
 *
 * 优先 navigator.clipboard（HTTPS / localhost / file 下可用，异步）；
 * 不可用或失败时回退到隐藏 textarea + document.execCommand('copy')（同步兜底）。
 * 返回是否复制成功。
 */
export async function copyText(text: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    clipboard?: { writeText(data: string): Promise<void> }
  }
  if (nav.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text)
      return true
    } catch {
      // 降级到 execCommand
    }
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.readOnly = true
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
