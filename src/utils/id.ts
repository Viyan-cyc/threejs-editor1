let sequence = 0

/**
 * 生成简单唯一 id（mock 阶段够用）。
 * 形如 `prefix-1718600000000-1`。
 */
export function uid(prefix = 'id'): string {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}
