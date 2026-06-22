import { buildSandboxRuntimeHtml } from '@/sandbox/runtimeHtml'
import type { RunResult, SandboxToMain } from '@/sandbox/protocol'

/** 运行超时（ms），防死循环/卡死 */
const RUN_TIMEOUT_MS = 8000

/**
 * 场景沙箱宿主：管理一个 sandbox iframe，接收主应用的 run(code)，
 * 在 iframe 内执行 createScene，等待 ready/error 回传。
 *
 * 安全：iframe sandbox="allow-scripts"（无 allow-same-origin）；主应用只接收
 * postMessage 回传的快照，不持有 iframe 内的任何对象引用。
 */
export class SceneSandboxHost {
  readonly el: HTMLIFrameElement

  private runCounter = 0
  private current: { runId: number; resolve: (r: RunResult) => void; timer: number } | null = null

  private readyPromise: Promise<void>
  private resolveReady: (() => void) | null = null

  constructor() {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block'
    iframe.srcdoc = buildSandboxRuntimeHtml()
    this.el = iframe

    // iframe 每次（重新）加载后重置 ready 等待
    iframe.addEventListener('load', () => this.resetReady())
    window.addEventListener('message', this.handleMessage)

    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve
    })
  }

  private resetReady(): void {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve
    })
  }

  /** 运行一段 createScene 代码；成功返回场景快照，失败返回 error */
  async run(code: string): Promise<RunResult> {
    await this.readyPromise

    const runId = ++this.runCounter
    return new Promise<RunResult>((resolve) => {
      // 取消上一轮未完成的运行
      if (this.current) {
        clearTimeout(this.current.timer)
        this.current.resolve({ ok: false, error: '被新一轮运行取代' })
      }

      const timer = window.setTimeout(() => {
        if (this.current?.runId === runId) {
          this.current = null
          resolve({ ok: false, error: '运行超时（可能存在死循环）' })
        }
      }, RUN_TIMEOUT_MS)

      this.current = { runId, resolve, timer }
      this.post({ type: 'run', runId, code })
    })
  }

  private handleMessage = (event: MessageEvent): void => {
    // 严格校验：只接受来自本 iframe 的消息
    if (event.source !== this.el.contentWindow) return
    const message = event.data as SandboxToMain | null
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return

    if (message.type === 'runtime-ready') {
      this.resolveReady?.()
      this.resolveReady = null
      return
    }

    if (!this.current) return
    if (message.type === 'ready' && message.runId === this.current.runId) {
      clearTimeout(this.current.timer)
      const current = this.current
      this.current = null
      current.resolve({ ok: true, snapshot: message.snapshot })
    } else if (message.type === 'error' && message.runId === this.current.runId) {
      clearTimeout(this.current.timer)
      const current = this.current
      this.current = null
      current.resolve({ ok: false, error: message.message })
    }
  }

  private post(message: unknown): void {
    this.el.contentWindow?.postMessage(message, '*')
  }

  /**
   * 注入本轮预生成的混元 GLB（主进程生成的 ArrayBuffer）。
   * 必须在 run() 之前调用：iframe 收到后存入 window.__preloadedModels 并回 assets-ready，
   * createScene 内 ctx.getModel(key) 才能取到。
   * 用结构化克隆（非 Transferable）：主进程保留 buffer，供自动修复多轮复用同 key，不重复调混元/下载。
   */
  async setModels(models: Record<string, ArrayBuffer>): Promise<void> {
    await this.readyPromise
    console.log('[hy] setModels → iframe inject-assets，keys:', Object.keys(models)) // 【临时诊断】
    this.el.contentWindow?.postMessage({ type: 'inject-assets', models }, '*')
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent): void => {
        if (event.source !== this.el.contentWindow) return
        if (event.data?.type === 'assets-ready') {
          console.log('[hy] iframe ← assets-ready（注入完成）') // 【临时诊断】
          window.removeEventListener('message', handler)
          resolve()
        }
      }
      window.addEventListener('message', handler)
    })
  }

  dispose(): void {
    window.removeEventListener('message', this.handleMessage)
    if (this.current) {
      clearTimeout(this.current.timer)
      this.current = null
    }
    this.el.remove()
  }
}
