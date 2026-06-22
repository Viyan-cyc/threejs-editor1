import type { HunyuanRequest } from '@/types/llm'

/**
 * 混元3D 预生成 —— 主进程在 sandbox 运行前，按 LLM 声明的 hunyuanRequests 逐个调
 * POST /hunyuan3d/generate（[build/hunyuanMiddleware.ts](../../build/hunyuanMiddleware.ts)）
 * 生成 GLB，下载为 ArrayBuffer，组装成 {key → ArrayBuffer} 注入 sandbox（createScene 内
 * ctx.getModel 取用）。
 *
 * - 串行 + 进度上报（i/N）。单个失败 catch 后跳过、记入 failures，不中断整体
 *   → 失败的 key 不注入 → createScene 走几何兜底分支（场景仍可见）。
 * - 落盘缓存：同 prompt 在 middleware 侧命中缓存秒回；此处再 fetch 本地 GLB（快）。
 * - 与 [hunyuanMiddleware.ts](../../build/hunyuanMiddleware.ts) 的 GenerateDSL 契约一致：
 *   body 字段 prompt / enablePbr / faceCount / generateType（snake_case 由 middleware 转换）。
 */
export interface HunyuanGenerateFailure {
  key: string
  reason: string
}

export interface HunyuanGenerateResult {
  models: Record<string, ArrayBuffer>
  failures: HunyuanGenerateFailure[]
}

export async function generateHunyuanModels(
  requests: HunyuanRequest[],
  onProgress: (label: string) => void,
): Promise<HunyuanGenerateResult> {
  const models: Record<string, ArrayBuffer> = {}
  const failures: HunyuanGenerateFailure[] = []
  const total = requests.length

  for (let i = 0; i < requests.length; i += 1) {
    const req = requests[i]
    const tag = `${req.key}（${i + 1}/${total}）`
    onProgress(`正在生成 3D 模型：${tag}…`)
    try {
      const res = await fetch('/hunyuan3d/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt,
          enablePbr: req.enablePbr ?? true,
          faceCount: req.faceCount,
          generateType: req.generateType,
        }),
      })
      // middleware 成功时直接返回 GLB 二进制（Content-Type: model/gltf-binary）；
      // 失败时返回 JSON error + 非 200 状态码。按状态码分支。
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const e = (await res.json()) as { message?: string; error?: string }
          detail = e.message ?? e.error ?? detail
        } catch {
          /* 响应非 JSON，保留 status */
        }
        console.log('[hy-gen] key=' + req.key + ' POST 失败 →', res.status, detail) // 【临时诊断】
        failures.push({ key: req.key, reason: detail })
        continue
      }
      const buf = await res.arrayBuffer()
      const magic = Array.from(new Uint8Array(buf).slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')
      console.log('[hy-gen] key=' + req.key + ' POST →', res.status,
        '| cached:', res.headers.get('x-hunyuan-cached'),
        '| buf', buf.byteLength, '字节 magic:', magic,
        magic === '67 6c 54 46' ? '(真GLB ✓)' : '(非GLB ✗)') // 【临时诊断】
      // magic 校验：真 GLB 前4字节必为 'glTF'(67 6c 54 46)。判失败不缓存 → getModel 取不到 → 走几何兜底。
      if (magic !== '67 6c 54 46') {
        failures.push({ key: req.key, reason: `GLB 内容非法 magic=${magic}（响应非 GLB 二进制）` })
        continue
      }
      models[req.key] = buf
    } catch (err) {
      failures.push({ key: req.key, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { models, failures }
}
