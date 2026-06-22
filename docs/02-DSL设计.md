# Three.js Editor · DSL 设计说明（v0.2）

> 状态：**仅设计**，本轮不写代码、不实现序列化器。
> 本文档是 DSL 格式的权威定义。`src/types/scene.ts` 里的 `DslSnapshot` 是第 1 阶段占位类型，后续实现步骤会按本文替换。

---

## 0. 设计目标

DSL 是一份 **JSON 文档**，需同时满足：

1. 能**完整还原**一个 Three.js 场景（场景 / 相机 / 灯光 / 物体 / 材质 / 几何 / 变换 / 层级）。
2. **LLM 友好**：结构扁平可预测、字段语义直白、可选字段带默认值、旋转用度数、颜色用 hex、向量用数组。
3. **稳定 id**：每个对象（含每个 part）有稳定且全局唯一的 `id`，便于序列化稳定、检索引用、以及未来按 id 定位。
4. **可转 Three.js**：层级用统一 `children`，与 `Object3D` 场景图 1:1。
5. **可转 HTML**：对象自描述，便于逐对象生成代码。

---

## 1. 数据流与因果关系（最重要，不要弄混）

```
【编辑回路 · 每轮】
  用户输入
    → LLM 生成 / 修改【3D 场景】（Three.js 场景代码 / 场景构造）
    → 系统构建 / 更新 Object3D 场景
    → 系统序列化场景 →【生成 DSL】（派生快照）

【还原回路 · 按需】
  保存的 DSL → 反序列化重建 Object3D 场景（"还原场景"）
```

**关键约定：**
- **3D 场景是「因」，DSL 是「果」。** DSL 由已构建的 3D 场景**序列化生成**，每轮重新生成。
- **LLM 不编辑 DSL 来影响 3D 场景。** 多轮的增/改/删/移发生在 **3D 场景层**：LLM 通过对象身上的稳定 id（`Object3D.userData.id`）定位目标，改的是场景对象，DSL 随后由场景重生成。
- DSL → 场景（还原回路）仅用于「从保存的 DSL 重建场景」，不是编辑通路。

> 因此：**不存在「LLM 对 DSL 做操作补丁」这条路径。** 上一版草稿里提到的 operations 补丁已据此移除。

---

## 2. 顶层结构

```jsonc
{
  "version": "0.2",          // DSL 版本号（schema 演进用）
  "metadata": { ... },        // 可选：标题、描述、生成来源等
  "scene":    { ... },        // 场景基础信息（背景、网格、雾、单位、坐标轴）
  "camera":   { ... },        // 相机
  "lights":   [ ... ],        // 灯光数组
  "objects":  [ ... ]         // 根级对象数组；每个对象可有 children 形成层级
}
```

> 材质**只内联**在对象上（不做顶层共享材质注册表，本轮决策）。

---

## 3. 字段含义

### 3.1 metadata（可选）
自由键值，建议字段：`title`、`description`、`createdAt`(ISO)、`generator`(`"llm"`/`"manual"`)、`tags[]`。

### 3.2 scene
| 字段 | 含义 | 默认 |
|---|---|---|
| `background` | 背景色 hex | `#f4f5f7` |
| `grid` | `{ enabled, size, divisions }` 参考网格 | `{enabled:true,size:20,divisions:20}` |
| `fog` | `{type:"linear",near,far,color}` 或 `{type:"exp2",density,color}` | 无 |
| `units` | 单位 | `"meters"` |
| `upAxis` | 向上轴 | `"y"` |

### 3.3 camera
| 字段 | 含义 | 默认 |
|---|---|---|
| `type` | 目前仅 `"perspective"` | — |
| `position` | 相机位置 `[x,y,z]` | — |
| `target` | 视线目标点（OrbitControls target） | `[0,0,0]` |
| `fov` | 视场角（度） | `60` |
| `near` / `far` | 近/远裁剪面 | `0.1` / `1000` |

### 3.4 lights（数组）
每个灯光带 `id`。
| 字段 | 含义 |
|---|---|
| `id` | 稳定唯一 id |
| `type` | `ambient` / `hemisphere` / `directional` / `point` / `spot` |
| `intensity` | 强度（默认 `1`） |
| `color` | hex（默认 `#ffffff`） |
| `position` | 位置（位置型/方向型灯光用） |
| `groundColor` | hemisphere 地面色 |
| `angle` / `penumbra` | spot 专用 |

### 3.5 objects（核心，判别联合，按 `type` 区分）

**所有对象共有的基础字段：**
| 字段 | 含义 | 默认 |
|---|---|---|
| `id` | **稳定且全局唯一**的标识（见 §4） | 必填 |
| `name` | 人类可读名称 | 可选 |
| `type` | 对象类型（见下） | 必填 |
| `position` | 位置 `[x,y,z]` | `[0,0,0]` |
| `rotation` | 欧拉角 `[rx,ry,rz]`，**单位：度**，XYZ 顺序，渲染时转弧度 | `[0,0,0]` |
| `quaternion` | 四元数 `[x,y,z,w]`（与 rotation 二选一；**同时给出时 quaternion 优先**） | 可选 |
| `scale` | 缩放 `[x,y,z]` | `[1,1,1]` |
| `visible` | 是否可见 | `true` |
| `metadata` | 任意附加信息 | 可选 |
| `children` | 子对象数组（**统一的层级机制**） | 可选 |

> transform 示例（quaternion 用法）：
> ```json
> { "id": "prop_1", "type": "primitive", "geometry": { "type": "box" },
>   "quaternion": [0.3827, 0, 0, 0.9239], "position": [0, 1, 0] }
> ```
> （上例四元数等价于绕 X 轴旋转 45°；给了 quaternion 就忽略 rotation。）

**对象类型（`type`）：**

| type | 含义 | 类型专有字段 |
|---|---|---|
| `primitive` | 基础几何体（box/sphere/cylinder/cone/plane/torus/ring…） | `geometry`、`material` |
| `group` | 纯容器（无自身 mesh），仅靠 `children` 组织 | — |
| `lowPolyComposite` | 由多个基础 mesh 拼成的低模物体；其 `children` 即「parts」 | — |
| `component` | 自定义组件（如货架 Shelf），按名查注册表实例化 | `component`、`props` |
| `externalModel` | 外部模型（混元等生成的 glb/gltf），异步加载 | `format`、`url` |
| `instances` | 批量 / 程序化对象（如 InstancedMesh），一个节点表达多个实例 | `geometry`、`material`、`count`、`transforms`（**待细化**） |

> **关于 parts（已确认）**：用 **`children` 统一表达层级**。`lowPolyComposite` 的「parts」就是它的 `children`，`group` 的成员也是 `children`。层级只有一种机制，类型只表达「意图」（group=任意容器；lowPolyComposite=有意设计的多部件物体）。

> **关于 `instances`（已决策新增，待细化）**：用于 InstancedMesh / 程序化大批量对象，避免为每个实例单独建 Mesh。初步字段设想：`{ type:'instances', geometry, material, count, transforms:[[pos,rot,scale],...] }` 或带 `generator`（按规则生成实例，DSL 只存规则不存每个实例）。每个实例 id 用 `<节点id>_<index>`。具体 schema 后续单独细化。

**primitive 的 `geometry`（判别联合）：**
| type | 参数（均可选，带默认） |
|---|---|
| `box` | `width`,`height`,`depth`（默认 1） |
| `sphere` | `radius`(0.5),`segments`(32) |
| `cylinder` | `radiusTop`(0.5),`radiusBottom`(0.5),`height`(1),`segments`(32) |
| `cone` | `radius`(0.5),`height`(1),`segments`(32) |
| `plane` | `width`(1),`height`(1) |
| `torus` | `radius`(1),`tube`(0.4),`radialSegments`(12),`tubularSegments`(48) |
| `ring` | `innerRadius`(0.5),`outerRadius`(1),`segments`(32) |

**material（只内联，挂在对象上）：**
| 字段 | 含义 | 默认 |
|---|---|---|
| `type` | `standard`/`basic`/`phong` | `standard` |
| `color` | hex | `#ffffff` |
| `emissive` | 自发光 hex | `#000000` |
| `metalness` | 金属度（standard） | `0` |
| `roughness` | 粗糙度（standard） | `0.5` |
| `opacity` | 不透明度 | `1` |
| `transparent` | 是否透明 | `false` |
| `side` | `front`/`back`/`double` | `front` |
| `map` | 纹理贴图 URL | — |

---

## 4. id 规则（稳定性的根基）

1. **全局唯一**：整个文档内 `id`（lights / objects 全层级）不能重复，重复即非法。
2. **稳定**：对象 id 在其生命周期内**永不变**。**不要把层级路径写进 id**（如 `car_1/wheel_fl`）——移动/重组父级时路径会变，破坏稳定。id 只是一个语义 token。
3. **语义化命名**：`snake_case`，能读懂，如 `car_1`、`wheel_front_left`、`shelf_aisle_a`、`stand_east`。同类新增追加数字后缀（`car_2`）。
4. **来源（重要）**：因为 DSL 由场景序列化生成，稳定 id **起源于场景构造**——LLM/组件工厂/加载器在创建 `Object3D` 时写入 `userData.id`，**序列化器读取 `userData.id` 写进 DSL**。若某对象没有 `userData.id`，序列化器按规则补一个（并回写场景，使其后续稳定）。

### 4.1 DSL 字段 ↔ Three.js Object3D 对应
| DSL | Three.js |
|---|---|
| `id` | `object3D.userData.id` |
| `position` / `scale` / `visible` | `object3D.position` / `.scale` / `.visible` |
| `rotation`（度） | `object3D.rotation`（转弧度） |
| `quaternion` | `object3D.quaternion` |
| `children` | `object3D.children` |
| `primitive` 的 geometry/material | `Mesh` 的 `geometry`/`material` |
| `group` / `lowPolyComposite` | `Group` |

---

## 5. 多轮对话如何演进（场景为主，DSL 派生）

每轮：
1. 用户输入新指令。
2. LLM 基于「当前 3D 场景状态 + 新指令」，**生成/修改 3D 场景**。定位目标靠对象身上的稳定 id（`userData.id`）。
3. 系统构建/更新 Object3D 场景。
4. 系统序列化新场景 → **重新生成 DSL**。

因此：
- **「移动篮球架」** = LLM 改场景里 `id=basketball_hoop_1` 的 Object3D 位置 → 场景变 → 重生成的 DSL 中该对象 position 已变。
- **「删除东侧看台」** = LLM 从场景移除 `id=stand_east` 的 Object3D → 重生成的 DSL 不再包含它。
- **「加篮球架」** = LLM 在场景新建带 `userData.id=basketball_hoop_1` 的对象 → DSL 中出现它。

> 全程 LLM 改的是 **3D 场景对象**；下面的 DSL 变化都是「序列化结果」，不是 LLM 写的输入。

### 端到端：派生 DSL 的变化（操场 → +篮球架 → 左移 → 删看台）

第 1 轮后，派生 DSL 的 objects 含：
```jsonc
{ "id": "playground_1", "type": "group", "children": [
    { "id": "playground_1_grass", ... },
    { "id": "playground_1_track", ... },
    { "id": "playground_1_goal_north", ... },
    { "id": "playground_1_stand_east", "type": "primitive", "position": [12, 0.75, 0], ... },
    { "id": "playground_1_stand_west", ... }
]}
```

第 2 轮（LLM 在场景里新增篮球架）后，派生 DSL 多出：
```jsonc
{ "id": "basketball_hoop_1", "type": "lowPolyComposite", "position": [5, 0, 0],
  "children": [ { "id": "basketball_hoop_1_pole", ... }, { "...board": ... }, { "...ring": ... } ] }
```

第 3 轮（LLM 把篮球架左移）后，派生 DSL 中：
```jsonc
{ "id": "basketball_hoop_1", ..., "position": [-5, 0, 0], ... }   // position 由 [5,0,0] 变 [-5,0,0]
```

第 4 轮（LLM 删除东侧看台）后，派生 DSL 中 `playground_1_stand_east` 消失。

> 四轮里 `playground_1`、`basketball_hoop_1` 等 id 始终不变——稳定 id 让「移动/删除」在场景层精确命中，DSL 只是如实地反映结果。

---

## 6. 典型示例

### 示例 1：单个立方体（完整文档）
```json
{
  "version": "0.2",
  "metadata": { "title": "单个立方体" },
  "scene": { "background": "#f4f5f7", "grid": { "enabled": true, "size": 20, "divisions": 20 } },
  "camera": { "type": "perspective", "position": [4, 3, 5], "target": [0, 0.5, 0], "fov": 60 },
  "lights": [
    { "id": "hemisphere_1", "type": "hemisphere", "intensity": 1, "color": "#ffffff" }
  ],
  "objects": [
    {
      "id": "cube_1",
      "name": "立方体",
      "type": "primitive",
      "geometry": { "type": "box", "width": 1, "height": 1, "depth": 1 },
      "material": { "type": "standard", "color": "#4f8cff", "roughness": 0.5 },
      "position": [0, 0.5, 0]
    }
  ]
}
```

### 示例 2：由多个 mesh 组成的 low-poly 小车
```json
{
  "id": "car_1",
  "name": "小汽车",
  "type": "lowPolyComposite",
  "position": [0, 0, 0],
  "children": [
    { "id": "car_1_body", "type": "primitive",
      "geometry": { "type": "box", "width": 2.2, "height": 0.5, "depth": 1 },
      "material": { "type": "standard", "color": "#d23b3b", "roughness": 0.4 },
      "position": [0, 0.5, 0] },
    { "id": "car_1_cabin", "type": "primitive",
      "geometry": { "type": "box", "width": 1.1, "height": 0.45, "depth": 0.9 },
      "material": { "type": "standard", "color": "#222831", "metalness": 0.3, "roughness": 0.2 },
      "position": [-0.1, 0.95, 0] },
    { "id": "car_1_wheel_fl", "type": "primitive",
      "geometry": { "type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.2 },
      "rotation": [90, 0, 0], "position": [0.7, 0.3, 0.55],
      "material": { "type": "standard", "color": "#111111" } },
    { "id": "car_1_wheel_fr", "type": "primitive",
      "geometry": { "type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.2 },
      "rotation": [90, 0, 0], "position": [0.7, 0.3, -0.55],
      "material": { "type": "standard", "color": "#111111" } },
    { "id": "car_1_wheel_rl", "type": "primitive",
      "geometry": { "type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.2 },
      "rotation": [90, 0, 0], "position": [-0.7, 0.3, 0.55],
      "material": { "type": "standard", "color": "#111111" } },
    { "id": "car_1_wheel_rr", "type": "primitive",
      "geometry": { "type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.2 },
      "rotation": [90, 0, 0], "position": [-0.7, 0.3, -0.55],
      "material": { "type": "standard", "color": "#111111" } }
  ]
}
```
> 圆柱默认轴沿 Y，`rotation:[90,0,0]` 让轮轴沿 Z，轮子正确朝向左右两侧。

### 示例 3：使用 component 的货架
```json
{
  "id": "shelf_aisle_a",
  "name": "A区货架",
  "type": "component",
  "component": "Shelf",
  "props": { "levels": 4, "width": 2, "depth": 0.6, "height": 2.4, "color": "#8a6d3b" },
  "position": [0, 0, 0]
}
```
> `component` 是注册表里的组件名；`props` 传给组件工厂（如 `new Shelf(props)`），由组件决定如何生成 Object3D（并在内部为各 part 写 `userData.id`）。转 HTML 时需 import 该组件（可移植性见 [01-产品需求说明.md](./01-产品需求说明.md) 风险点 5）。

### 示例 4：使用 externalModel 的外部模型
```json
{
  "id": "statue_1",
  "name": "雕塑",
  "type": "externalModel",
  "format": "glb",
  "url": "https://cdn.example.com/models/statue.glb",
  "position": [3, 0, 2],
  "scale": [1.2, 1.2, 1.2]
}
```
> 渲染时异步加载（GLTFLoader），加载后为其根 Object3D 写 `userData.id`。转 HTML 时需从该 URL 拉取模型。

### 示例 5：包含多个元素的操场（group + primitive + lowPolyComposite）
```json
{
  "id": "playground_1",
  "name": "操场",
  "type": "group",
  "children": [
    { "id": "playground_1_grass", "type": "primitive",
      "geometry": { "type": "plane", "width": 24, "height": 16 },
      "material": { "type": "standard", "color": "#3a9d3a", "roughness": 0.9 },
      "rotation": [-90, 0, 0], "position": [0, 0, 0] },
    { "id": "playground_1_track", "type": "primitive",
      "geometry": { "type": "ring", "innerRadius": 4, "outerRadius": 5, "segments": 64 },
      "material": { "type": "standard", "color": "#c0432f", "roughness": 0.8 },
      "rotation": [-90, 0, 0], "position": [0, 0.01, 0] },
    { "id": "playground_1_goal_north", "type": "lowPolyComposite",
      "position": [0, 0, -7],
      "children": [
        { "id": "playground_1_goal_north_post_l", "type": "primitive",
          "geometry": { "type": "cylinder", "radiusTop": 0.05, "radiusBottom": 0.05, "height": 2 },
          "material": { "color": "#ffffff" }, "position": [-3, 1, 0] },
        { "id": "playground_1_goal_north_post_r", "type": "primitive",
          "geometry": { "type": "cylinder", "radiusTop": 0.05, "radiusBottom": 0.05, "height": 2 },
          "material": { "color": "#ffffff" }, "position": [3, 1, 0] },
        { "id": "playground_1_goal_north_bar", "type": "primitive",
          "geometry": { "type": "cylinder", "radiusTop": 0.05, "radiusBottom": 0.05, "height": 6 },
          "rotation": [0, 0, 90], "material": { "color": "#ffffff" }, "position": [0, 2, 0] }
      ] },
    { "id": "playground_1_stand_east", "type": "primitive",
      "geometry": { "type": "box", "width": 1, "height": 1.5, "depth": 16 },
      "material": { "color": "#9aa0a6" }, "position": [12, 0.75, 0] },
    { "id": "playground_1_stand_west", "type": "primitive",
      "geometry": { "type": "box", "width": 1, "height": 1.5, "depth": 16 },
      "material": { "color": "#9aa0a6" }, "position": [-12, 0.75, 0] }
  ]
}
```

---

## 7. 校验规则（实现时强制）

1. `version` 必填；未知版本按最接近的兼容策略处理 + 警告。
2. 所有 `id`（lights / objects 全层级）**全局唯一**，重复拒绝。
3. 对象 `type` 必须是枚举值之一；`primitive` 必须有 `geometry` 且 `geometry.type` 合法。
4. `component` 名必须在组件注册表中存在。
5. `externalModel.url` 必须是非空字符串。
6. 向量字段长度为 3；`quaternion` 长度为 4；颜色为合法 hex。
7. `rotation` 与 `quaternion` 同时存在时，以 `quaternion` 为准（不报错，忽略 rotation）。

---

## 8. 转换说明（后续实现，不在本轮）

- **场景 → DSL（序列化，主方向）**：遍历 Object3D 树，读 `userData.id`、transform、geometry/material/类型，组装 DSL。component/externalModel 对象序列化为对应的引用型节点（记录组件名+props / 模型 url）。
- **DSL → 场景（还原）**：递归 `objects`，按 `type` 构造 Object3D（primitive→Mesh，度数→弧度，quaternion 优先；group/lowPolyComposite→Group 装 children；component→查注册表实例化；externalModel→GLTFLoader 异步加载），并把 `id` 写回 `userData.id`。
- **DSL → HTML**：按对象逐个生成 three.js 代码；配 import map 外壳即为可运行 HTML。

---

## 9. 已确认的设计决策

1. **parts 统一用 `children`**，仅以 `type` 区分组容器 / 低模组合。✅
2. **多轮：场景为主，DSL 派生**。LLM 改 3D 场景，DSL 每轮由场景重生成；不存在「LLM 改 DSL」。✅
3. **材质只内联**，不做顶层共享材质注册表。✅
4. **rotation 用度数**（XYZ，渲染转弧度）。✅
5. **同时支持 `rotation`（Euler 度数）与 `quaternion`**，二者并存时 quaternion 优先。✅
