/**
 * 沙箱消息协议 + 场景快照传输格式 + 代码静态检查。
 *
 * 主应用 <-> sandbox iframe 之间只通过 postMessage 通信。
 * 安全：主应用 onmessage 严格校验 event.source === iframe.contentWindow
 * （srcdoc iframe 的 origin 为 "null"，故用 source 比对而非 origin）。
 *
 * DSL 是 iframe 内"运行后提取"的快照经 postMessage 回传的衍生数据，
 * 不作为渲染源（Code-first，详见 docs/03、docs/05）。
 */

// ===== 主应用 -> iframe =====
export type MainToSandbox =
  | { type: 'run'; runId: number; code: string }
  | { type: 'dispose' }

// ===== iframe -> 主应用 =====
export type SandboxToMain =
  | { type: 'runtime-ready' }
  | { type: 'ready'; runId: number; snapshot: SceneSnapshot }
  | { type: 'error'; runId: number; message: string; stack?: string }

// ===== 场景快照（iframe 内对运行后 Object3D 的纯结构化序列化） =====
export interface SnapshotMaterial {
  type: string
  color?: string
  emissive?: string
  metalness?: number
  roughness?: number
  opacity?: number
  transparent?: boolean
  side?: number
}

export interface SnapshotNode {
  userData: Record<string, unknown> | null
  /** Object3D.type，如 'Mesh'/'Group'/'GridHelper' */
  threeType: string
  isMesh: boolean
  isLight: boolean
  isCamera: boolean
  position: [number, number, number]
  /** 弧度 */
  rotation: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
  visible: boolean
  geometry: { type: string; parameters?: Record<string, number> } | null
  material: SnapshotMaterial | null
  light?: { intensity?: number; color?: string; castShadow?: boolean }
  camera?: { fov?: number; near?: number; far?: number }
  children: SnapshotNode[]
}

export interface SceneSnapshot {
  background: string | null
  /** createScene 返回的主相机 */
  camera: SnapshotNode | null
  /** scene.children */
  rootNodes: SnapshotNode[]
}

// ===== 运行结果 =====
export type RunResult = { ok: true; snapshot: SceneSnapshot } | { ok: false; error: string }

/**
 * 代码静态检查（预检，主应用侧）。命中禁用模式则不送入 iframe，直接报错。
 * 这是第一道防线；sandbox 隔离是兜底。后续可升级为 AST。
 */
const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: 'eval', re: /\beval\s*\(/ },
  { label: 'Function', re: /\bnew\s+Function\b|\bFunction\s*\(/ },
  { label: 'fetch', re: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', re: /\bWebSocket\b/ },
  { label: 'EventSource', re: /\bEventSource\b/ },
  { label: 'sendBeacon', re: /\bsendBeacon\b/ },
  { label: '动态import', re: /\bimport\s*\(/ },
  { label: 'Worker', re: /\bWorker\b|SharedWorker|ServiceWorker|importScripts/ },
  { label: 'localStorage', re: /\blocalStorage\b/ },
  { label: 'sessionStorage', re: /\bsessionStorage\b/ },
  { label: 'indexedDB', re: /\bindexedDB\b/ },
  { label: 'cookie', re: /\bcookie\b/ },
  { label: 'parent/top/opener', re: /\b(parent|top|opener|frames)\b/ },
  { label: 'location/history', re: /\b(location|history)\b/ },
  { label: 'postMessage', re: /\bpostMessage\b/ },
  { label: 'window/document/globalThis', re: /\b(window|document|globalThis|self)\b/ },
  { label: 'navigator/crypto', re: /\b(navigator|crypto)\b/ },
  { label: 'setTimeout/setInterval(字符串)', re: /\b(setTimeout|setInterval)\s*\(/ },
]

export function checkSceneCode(code: string): string[] {
  const violations: string[] = []
  for (const rule of FORBIDDEN) {
    if (rule.re.test(code)) violations.push(rule.label)
  }
  return violations
}
