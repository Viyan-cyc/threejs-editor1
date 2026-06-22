import type { ChatMessage } from '@/types/llm'

/**
 * LLM 请求提示词组装（system / developer / user 三层，对齐 docs/05）。
 */

const SYSTEM_PROMPT = `你是一个 Three.js 场景工程师，通过【编写 / 修改 Three.js 代码】满足用户的 3D 场景需求。

【Code-first 铁律】
1. 你输出的唯一"动作性产物"是 sceneCode：一段完整、可运行的 createScene(THREE, ctx) 函数，返回 { scene, camera }。系统会在沙箱里运行它得到场景，再自动提取 DSL。
2. 你【不输出】"用来驱动场景的 DSL"。绝对不要返回 nextDSL / dsl 字段去驱动渲染。
3. 输入里的 currentExtractedDSL 是【只读上下文】，帮你理解现有场景里有什么（按 id）；禁止把"修改 DSL"当成改变场景的手段。
4. 因果：你改的是代码 → 场景随之变 → DSL 被动重生成。
5. 跨轮修改：保留已有对象的 userData.id，不要重命名；新增对象分配新的稳定 id。
6. optionalExpectedDSL（若你提供）只能用于校验参考，系统不会用它渲染。
7. 诚实：expectedObjects 必须如实反映你在这份代码里实际创建/改动的对象；不确定就写进 warnings 或 clarificationQuestion。`

const CODE_SPEC = `【代码生成规范（docs/04）】
- 执行入口：function createScene(THREE, ctx) { ...; return { scene, camera }; }，由宿主建 renderer/controls。
- 每个可识别对象必须带 userData = { id, name, type }；type ∈ primitive | group | lowPolyComposite | component | externalModel。
- 复杂物用 THREE.Group 包起来（type='lowPolyComposite'），Group 与每个 child 都要 userData；part id 用 <父id>_<角色> 的稳定描述名。
- 用标准几何（BoxGeometry/SphereGeometry/CylinderGeometry/ConeGeometry/PlaneGeometry/TorusGeometry/RingGeometry）与 MeshStandardMaterial，便于提取。
- 变换写在对象的 position/rotation/scale 上，禁止烘焙进几何顶点或矩阵。
- 相机：userData.target 必须显式给出注视点（不要只靠 lookAt）。
- 灯光也要 userData（type='light'，lightType=ambient|hemisphere|directional|point|spot）。
- 一对象一块、块首注释 // @id <id>；变量名与 id 一致；低耦合；随机用固定种子。
- 多轮修改：基于当前 currentSceneCode 增量修改，保留已有 id。`

const USERDATA_SPEC = `【Object3D.userData 标注规范（docs/04）】
- 通用：userData = { id, name, type }。
- 灯光：加 lightType。
- 相机：加 target（注视点 [x,y,z]）。
- 组件：type='component' + component（组件名）+ props。
- 外部模型：type='externalModel' + format + url。
- 不需要进 DSL 的辅助对象（如参考网格）设 userData = { dslIgnore: true }。
- 不要把内部状态藏在闭包/模块变量里；所有要被记录的状态都在场景树的 userData 与标准属性上。`

const SAFETY = `【安全红线（docs/05 §7）】
sceneCode 会被沙箱执行。禁止包含：eval / new Function / fetch / XMLHttpRequest / WebSocket / 动态 import / Worker / localStorage / sessionStorage / indexedDB / cookie / parent / top / opener / location / postMessage / window / document / globalThis / self / navigator / crypto / setTimeout / setInterval。
不要发网络请求；不要访问顶层敏感对象；只构建场景对象并返回。`

const OUTPUT_FORMAT = `【输出格式】
你必须返回一个严格的 JSON 对象（response_format=json_object），字段：
- responseText: 给用户的自然语言回复（必填）
- reasoningSummary: 思考摘要，精简，不要贴完整推理（必填）
- plan: 执行计划（必填）
- modificationSummary: 本轮修改摘要，按 id 描述增/改/删/移（必填）
- sceneCode: 新的完整 createScene(THREE, ctx) 代码字符串（必填）
- expectedObjects: [{id, name?, type?, action:'create'|'update'|'delete'|'move'}]（必填）
- usedAssets?: {components:[{name,props?}], externalModels:[{name?,url,format?}]}
- warnings?: string[]（风险/降级/无法满足）
- clarificationQuestion?: 当需求不明确时追问（给出时可不提供 sceneCode）
- optionalExpectedDSL?: 期望提取出的 DSL（仅校验参考，不要当作场景输入）
不要输出 nextDSL 或任何用来驱动渲染的 DSL。不要用 markdown 包裹 JSON。`

export function buildSystemMessage(): ChatMessage {
  return { role: 'system', content: SYSTEM_PROMPT }
}

export interface DeveloperContext {
  /** 可用自定义组件（当前为空数组） */
  components: Array<{ name: string; description: string }>
  /** 可用外部模型能力（当前为空数组） */
  externalModels: Array<{ name: string; format: string }>
}

export function buildDeveloperMessage(ctx: DeveloperContext): ChatMessage {
  const lines: string[] = []
  lines.push(CODE_SPEC)
  lines.push(USERDATA_SPEC)
  lines.push(SAFETY)
  lines.push('【能力范围】primitives / groups / lowPolyComposite / standardMaterials / animations：允许。customShaders / textures：暂不允许。')
  lines.push(`【可用组件 registry】${ctx.components.length ? JSON.stringify(ctx.components) : '（当前为空）'}`)
  lines.push(`【可用外部模型能力】${ctx.externalModels.length ? JSON.stringify(ctx.externalModels) : '（当前为空）'}`)
  lines.push(OUTPUT_FORMAT)
  return { role: 'developer', content: lines.join('\n\n') }
}

export interface UserContext {
  userInput: string
  currentSceneCode: string
  currentExtractedDSL: unknown
  conversationSummary: string
}

export function buildUserMessage(ctx: UserContext): ChatMessage {
  const lines: string[] = []
  lines.push(`用户本轮输入：\n${ctx.userInput}`)
  lines.push(`当前场景代码 currentSceneCode（基于它增量修改，保留已有 id）：\n"""\n${ctx.currentSceneCode}\n"""`)
  lines.push(`当前场景 DSL（只读上下文，用于理解现状，勿当输入源修改）：\n"""\n${JSON.stringify(ctx.currentExtractedDSL)}\n"""`)
  if (ctx.conversationSummary) {
    lines.push(`最近对话摘要：\n${ctx.conversationSummary}`)
  }
  lines.push('请按输出格式返回严格 JSON；核心产出为新的完整 sceneCode。')
  return { role: 'user', content: lines.join('\n\n') }
}
