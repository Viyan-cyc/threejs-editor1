# LLM 接入协议设计（Code-first）

> 状态：**仅协议与提示词设计**，不写实现代码、不接 API。
> 背景：Code-first（见 [03-架构设计-Code-first.md](./03-架构设计-Code-first.md)）。LLM 的核心产出是 **Three.js 场景代码**；DSL 是给 LLM 的**上下文**与事后的**校验参考**，不是 LLM 驱动场景的输入。
> 关联：[04-代码生成规范.md](./04-代码生成规范.md)（代码约束）、[02-DSL设计.md](./02-DSL设计.md)（DSL 格式）。

---

## 0. 核心原则（贯穿全协议）

1. **LLM 输出的唯一"动作性产物"是 `sceneCode`**（完整 Three.js 场景代码）。
2. **DSL 只进不出**：DSL 作为输入上下文辅助 LLM 理解现有场景；LLM **不输出"用来驱动场景的 DSL"**。
3. **`optionalExpectedDSL` 仅作校验参考**：LLM 可选地给出"我期望提取出什么样"的 DSL，供系统与运行后真实提取的 DSL 比对，**绝不能作为渲染源**。
4. **`codePatch` 是可选的增量手段**，V1 以整份 `sceneCode` 为主，patch 留作后续。

---

## 1. LLM 输入设计

输入由前端在每轮**组装**成一个请求。分三层消息：system（恒定）/ developer（环境与约束）/ user（本轮上下文）。字段如下（概念结构，非最终代码）：

### 1.1 User 输入载荷（结构化上下文）
| 字段 | 含义 | 备注 |
|---|---|---|
| `userInput` | 用户本轮自然语言 | 必填 |
| `currentSceneCode` | 当前完整 Three.js 场景代码（源数据） | 首轮可为空/初始模板 |
| `currentExtractedDSL` | 从当前场景提取的 DSL 快照 | **上下文**，只读 |
| `componentRegistry` | 可用自定义组件清单（名称 + 描述 + props 契约 + 是否可用） | 见 §1.2 |
| `externalModelCapabilities` | 可用外部模型生成能力（如混元：名称、产物格式、是否启用、耗时量级） | |
| `conversationSummary` | 最近对话历史摘要（含历轮 modificationSummary） | 控长度 |
| `capabilityScope` | 当前允许使用的 Three.js 能力范围（见 §1.3） | |
| `forbiddenRules` | 当前禁止事项（安全红线，见 §6） | |

### 1.2 组件 registry 项结构
每项：`{ name, description, propsContract, available }`。
- `propsContract`：组件接受的 props 及类型/含义，供 LLM 正确调用并填 `userData.props`。
- `available`：是否在当前环境可用（未注册/未授权时为 false，提示 LLM 改用 Low Poly）。

### 1.3 能力范围 capabilityScope（示例枚举）
`{ primitives: true, groups: true, lowPoly: true, standardMaterials: true, textures: false, customShaders: false, animations: true, externalModels: true, components: true, instancing: false }`。
由前端按当前部署配置注入，约束 LLM 不越权使用能力。

---

## 2. LLM 输出设计（结构化 JSON）

LLM **必须**返回一个 JSON 对象（前端做严格解析）。字段：

| 字段 | 必填 | 含义 |
|---|---|---|
| `responseText` | ✅ | 给用户看的自然语言回复（简要说明做了什么） |
| `reasoningSummary` | ✅ | 思考摘要（含精简 chain-of-thought；**展示用**，非完整推理堆） |
| `plan` | ✅ | 执行计划（分步） |
| `modificationSummary` | ✅ | 本轮修改摘要（增/改/删/移了哪些对象，按 id） |
| `sceneCode` | ✅ | **新的完整 Three.js 场景代码**（核心动作产物，遵循 §6 安全约束与 [04](./04-代码生成规范.md) 规范） |
| `expectedObjects` | ✅ | 本轮预计生成/修改的对象列表：`[{id, name, type, action: 'create'|'update'|'delete'|'move'}]`，用于与运行后 DSL 校验 |
| `usedAssets` | ✅ | 使用的组件/外部模型：`{components:[{name,props}], externalModels:[{name,url,format}]}` |
| `warnings` | ⚪ | 风险/无法满足/降级说明（如组件不可用退回 Low Poly） |
| `clarificationQuestion` | ⚪ | 需求不明确时的追问；**有此项时前端应优先追问、暂不应用 sceneCode** |
| `codePatch` | ⚪ | 可选增量 diff（V1 不启用；启用时与 sceneCode 二选一） |
| `optionalExpectedDSL` | ⚪ | 期望提取出的 DSL（仅校验参考，**非渲染源**） |

**强约束：**
- **不设** `nextDSL` / `dsl` 作为驱动场景的主输出。
- `sceneCode` 与 `codePatch`（若提供）必须择一；V1 强制 `sceneCode`。
- `clarificationQuestion` 非空时，`sceneCode` 可省略或视为"草稿"，前端先追问。
- `expectedObjects` 的 id 必须遵循 [02](./02-DSL设计.md) §4 id 规则（稳定、唯一、不编码路径）。

---

## 3. System Prompt（角色与不可变原则）

> 恒定，每次请求固定。

要点：
- **角色**：你是一个 Three.js 场景工程师，通过**编写/修改 Three.js 代码**来满足用户的 3D 场景需求。
- **唯一动作产物是代码**：你输出的 `sceneCode` 是新的完整 Three.js 场景代码；系统会运行它得到场景、再自动提取 DSL。**你不输出"用来驱动场景的 DSL"。**
- **DSL 是只读上下文**：输入里的 `currentExtractedDSL` 帮你理解现有场景里有什么（按 id），但**禁止**把"修改 DSL"当成改变场景的手段。
- **因果**：你改的是代码 → 场景随之变 → DSL 被动重生成。
- **稳定性**：跨轮保留已有对象 id，不随意重命名；新增对象分配新 id。
- **诚实**：`expectedObjects` 必须如实反映你在这份代码里实际创建/改动的对象；不确定就放 `warnings` 或 `clarificationQuestion`。
- **安全**：严格遵守 `forbiddenRules` 与 §6，不输出危险代码。

---

## 4. Developer Prompt（环境、能力范围、约束注入）

> 每轮可变，注入当前环境信息。

内容：
1. **能力范围**：贴 `capabilityScope`（允许/禁止的能力）。
2. **组件 registry**：贴可用组件清单 + props 契约；不可用的明确标"不可用→改用 Low Poly"。
3. **外部模型能力**：贴 `externalModelCapabilities`。
4. **代码生成规范**：引用 [04](./04-代码生成规范.md) 的要点（执行契约 `createScene(THREE, ctx)`、userData 标注、Group 包 parts、一对象一块 `// @id`、不烘焙变换、标准几何材质等）。
5. **userData 标注规范**：每对象 `userData={id,name,type}` + 类型附加字段；light/camera 也要标注；`dslIgnore` 排除；相机 target 必存。
6. **安全红线**：贴 §6。
7. **输出格式**：要求**严格 JSON**，字段见 §2；代码放进 `sceneCode` 字符串字段，不要用 markdown 包裹整个响应。

---

## 5. User Prompt 组装方式

> 每轮由前端拼装，承载本轮动态上下文。

组装顺序（建议）：
1. `用户本轮输入：{userInput}`
2. `当前场景代码 currentSceneCode：\n"""{currentSceneCode}"""`
3. `当前场景 DSL（只读上下文，用于理解现状，勿当输入源修改）：\n"""{currentExtractedDSL}"""`
4. `最近对话摘要：{conversationSummary}`
5. 收尾指令：`请按输出协议返回严格 JSON；核心产出为新的完整 sceneCode。`

> 体量控制：`currentSceneCode` 与 DSL 可能很大 → 对历史用摘要、对代码做必要截断（保留 `// @id` 块结构），并明确告知 LLM 哪里被截断。长上下文策略另定。

---

## 6. 输出校验规则（前端强制）

解析与校验**分层**，任一层失败都有兜底（见 §7、§8）：

**L1 结构校验（JSON 可解析 + 必填字段齐全）：**
- 是合法 JSON 对象。
- `responseText / reasoningSummary / plan / modificationSummary` 非空字符串。
- `sceneCode` 非空字符串（除非 `clarificationQuestion` 非空）。
- `expectedObjects` 为数组、每项含 `id/type/action`。
- 不存在被禁用的"驱动型 DSL"主字段（如 `nextDSL`）→ 若出现，**忽略该字段**并记 warning。

**L2 代码静态校验（sceneCode）：**
- 含 `createScene` 入口（执行契约）。
- 不含 `forbiddenRules` 列出的危险模式（见 §9 正则/AST 检查）。
- 不引用 `capabilityScope` 禁用的能力（如禁用 customShaders 则不能出现 ShaderMaterial）。
- 能力范围检查仅为"软拦截"+ warning（避免误伤），硬拦截只针对安全红线。

**L3 运行后校验（与 expectedObjects 比对）：**
- 实际运行 sceneCode → 提取 DSL → 取出实际对象 id 集合。
- 与 `expectedObjects` 比对：缺失（说了创建但没出现）、多余（没说却出现）、未变更（说了改但 id 仍同且字段未变）。
- 比对结果记入运行 warnings；严重不一致可触发自修复（§8）。

**L4 DSL 完整性校验：**
- 提取出的对象是否有 `missing_id`/`missing_type` 等 warning（见 [extractor]）。
- `optionalExpectedDSL`（若有）与实际 DSL 结构比对 → 差异记 warning，**仅参考**。

---

## 7. sceneCode 安全约束（forbiddenRules）

代码将在**沙箱**中运行（iframe sandbox / Web Worker，详见 [03](./03-架构设计-Code-first.md) §9）。硬性禁止：

1. **不访问顶层敏感对象**：`window`（除明确允许的渲染相关）、`document`（除必要 DOM）、`globalThis`、`parent`、`top`、`opener`、`localStorage`/`sessionStorage`/`indexedDB`、`cookies`。
2. **不执行网络**：禁 `fetch`/`XMLHttpRequest`/`WebSocket`/`import(远程URL)`（外部模型加载由前端受控代理，非 LLM 代码直接发请求）。
3. **不执行动态代码**：禁 `eval`/`Function`/`new Function`/`setTimeout(string)`/`setInterval(string)`。
4. **不逃逸沙箱**：禁操作 `location`/`history`/导航、禁篡改原型链关键方法、禁 `postMessage` 到父。
5. **不无限循环/爆资源**：禁止无界 `while(true)`、超大几何分段、海量实例；动画用 `setAnimationLoop`/`requestAnimationFrame` 受控。
6. **不读敏感环境**：禁访问环境变量、本地文件、剪贴板、麦克风/摄像头。
7. **仅渲染到指定画布**：renderer 的 canvas 只能挂到 ctx 提供的容器，不挂 `document.body`。

> 执行环境层面：沙箱 iframe 用 `sandbox` 限制 + CSP；Web Worker 无 DOM 只能算几何（渲染仍需主线程 canvas）。**安全最终靠沙箱隔离，prompt 约束是第一道而非唯一道。**

---

## 8. 兜底策略

### 8.1 LLM 输出代码无法运行（throw / 不产出场景）
分级兜底：
1. **保留上一份可用场景**：不破坏当前 `currentSceneCode`/预览/DSL，用户仍能看到上一个有效状态。
2. **错误回灌自修复**：捕获运行时错误（含堆栈/报错位置），连同原 sceneCode 重新发给 LLM，要求"修复这段错误，仅返回修好的 sceneCode"，限制重试次数（如 ≤2）。
3. **降级**：若反复失败，向用户展示 `warnings`/错误 + LLM 的 `responseText`，并保留旧场景；可选"让我看看代码"。
4. **追问优先**：若 `clarificationQuestion` 非空，**不运行**新代码，直接把追问呈现给用户。

### 8.2 运行成功但 DSL 提取不完整（缺 id/缺 type/未识别几何材质）
按 warning 类型处理：
- `missing_id` / `missing_type`：说明 LLM 漏标 → **回灌 LLM**："对象 X 缺 userData.id/type，请按规范补标后重发 sceneCode"（可限定只重发相关块或整份）。
- `geometry_unknown` / `material_unknown`：用了非标准几何/材质 → 作为**有损**记录进 DSL（不阻塞），同时在 UI 提示"该对象在 DSL 中为有损记录"；若 `capabilityScope` 禁用该能力则升级为错误回灌。
- `expectedObjects` 与实际不符（L3）：记 warning；若"声明创建但实际缺失"超过阈值 → 触发 8.1 的回灌自修复。
- **绝不**为了"凑完整 DSL"而篡改场景或用 `optionalExpectedDSL` 反向覆盖真实提取结果——DSL 必须忠实反映运行结果，有损就标有损。

---

## 9. 为什么不应该让 LLM 直接修改 DSL 来驱动场景

（与 [03](./03-架构设计-Code-first.md) §6 一致，此处针对"LLM 改 DSL"再强调）

1. **代码表达力 ≫ DSL**：DSL 是静态结构快照，承载不了动画/过程化/着色器/交互/运行时逻辑；让 LLM 改 DSL 等于把产品降级成有限积木拼装器。
2. **扬长避短**：LLM 写 Three.js 代码强、写严格 DSL schema 弱；要它输出精确枚举/合法参数的 DSL 更易错。
3. **避免双源真相**：若 LLM 既改代码又改 DSL，两者必然漂移；以代码为唯一动作源，DSL 被动派生，一致性免费。
4. **往返保真**：从运行结果提取的 DSL 天然与场景一致；LLM 手写/手改的 DSL 不保证能落地。
5. **校验闭环成立**：正因为 DSL 是"运行后提取"，才能拿它和 `expectedObjects`/`optionalExpectedDSL` 比对去发现 LLM "说一套做一套"；若 DSL 由 LLM 直接写，这个校验就失效了。

> DSL 的正确用法：**只读上下文（输入）+ 事后校验参考（输出 optionalExpectedDSL）+ 衍生快照（系统提取）**。三种身份都不是"驱动场景的输入源"。

---

## 10. 待确认

1. **codePatch 何时启用**：V1 强制整份 sceneCode；patch 是否在场景变大后启用？（影响输出协议与前端应用逻辑）
2. **历史摘要策略**：`conversationSummary` 由前端生成还是让 LLM 每轮自摘要？
3. **外部模型加载归属**：LLM 代码能否直接调加载器，还是统一由前端受控代理（建议后者，符合 §7）？
4. **沙箱形态**：iframe sandbox 还是 Web Worker（决定 §7 哪些 API 天然不可用）？
5. **expectedObjects 不符的自动修复阈值**：多少比例/数量触发回灌？
