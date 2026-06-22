/**
 * 把毫秒格式化为"逐秒叠加"风格的时长字符串。
 *
 * 规则（与左栏生成中计时器的逐秒显示保持一致）：
 * - < 60s → `12s`
 * - ≥ 60s → `1min3s` / `2min0s`
 *
 * 运行中计时（基于 floor 的秒数）与生成结束后记录的最终耗时共用此函数，
 * 确保两者显示风格一致。
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const minutes = Math.floor(totalSec / 60)
  return `${minutes}min${totalSec % 60}s`
}
