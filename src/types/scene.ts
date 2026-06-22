/** 右侧结果区页签 */
export type ResultTab = 'preview' | 'html' | 'dsl'

/** 三维向量（位置 / 旋转 / 缩放） */
export type Vec3 = [number, number, number]

/** 四元数 [x, y, z, w] */
export type Vec4 = [number, number, number, number]

/** 变换：rotation（欧拉度数 XYZ）与 quaternion 二选一，并存时 quaternion 优先 */
export interface DslTransform {
  position?: Vec3
  rotation?: Vec3
  quaternion?: Vec4
  scale?: Vec3
}

/** DSL：相机 */
export interface DslCamera {
  id: string
  type: 'perspective'
  position: Vec3
  /** 注视点（取自 userData.target；three 相机不持久化 lookAt） */
  target: Vec3
  rotation?: Vec3
  fov: number
  near?: number
  far?: number
  warnings?: string[]
}

/** DSL：灯光 */
export interface DslLight extends DslTransform {
  id: string
  type: 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot'
  intensity?: number
  color?: string
  /** hemisphere 地面色 */
  groundColor?: string
  castShadow?: boolean
  warnings?: string[]
}

/** primitive 的 geometry（判别联合，按 type 区分） */
export type DslGeometry =
  | { type: 'box'; width?: number; height?: number; depth?: number }
  | { type: 'sphere'; radius?: number; segments?: number }
  | { type: 'cylinder'; radiusTop?: number; radiusBottom?: number; height?: number; segments?: number }
  | { type: 'cone'; radius?: number; height?: number; segments?: number }
  | { type: 'plane'; width?: number; height?: number }
  | { type: 'torus'; radius?: number; tube?: number; radialSegments?: number; tubularSegments?: number }
  | { type: 'ring'; innerRadius?: number; outerRadius?: number; segments?: number }

/** 材质（只内联） */
export interface DslMaterial {
  type?: 'standard' | 'basic' | 'phong'
  color?: string
  emissive?: string
  metalness?: number
  roughness?: number
  opacity?: number
  transparent?: boolean
  side?: 'front' | 'back' | 'double'
}

/** 对象的 userData（提取器读取，标注来源） */
export interface DslUserData {
  id: string
  name?: string
  type: DslAnnotationType
  /** 灯光子类型 */
  lightType?: DslLight['type']
  /** component 专用 */
  component?: string
  props?: Record<string, unknown>
  /** externalModel 专用 */
  format?: 'glb' | 'gltf'
  url?: string
  /** 相机注视点 */
  target?: Vec3
  /** 排查出 DSL */
  dslIgnore?: boolean
  [key: string]: unknown
}

/** DSL 对象类型（判别联合的判别字段） */
export type DslObjectType =
  | 'primitive'
  | 'group'
  | 'lowPolyComposite'
  | 'component'
  | 'externalModel'
  | 'instances'

/** 标注类型（userData.type）：对象类型 + light/camera（提取时分别路由到 lights[]/camera） */
export type DslAnnotationType = DslObjectType | 'light' | 'camera'

/** 运行时大类：来自 Object3D 的实际类型（与"标注意图"的 type 互补） */
export type DslObjectKind = 'mesh' | 'group' | 'light' | 'camera' | 'other'

/** 提取时的告警标记 */
export type DslWarningCode = 'missing_id' | 'missing_type' | 'geometry_unknown' | 'material_unknown'

/** DSL 对象：所有对象共有的基础字段 + children 层级 */
export interface DslObject extends DslTransform {
  id: string
  name?: string
  /** 标注意图（取自 userData.type，缺省 group） */
  type: DslObjectType
  /** 运行时大类（mesh/group/light/camera/other，来自 Object3D 实际类型） */
  objectKind: DslObjectKind
  visible?: boolean
  /** 自定义元信息（由提取器/前端刻意保留；非 userData 原样回显） */
  metadata?: Record<string, unknown>
  warnings?: DslWarningCode[]
  children?: DslObject[]
  /** primitive 专用 */
  geometry?: DslGeometry
  /** primitive 专用 */
  material?: DslMaterial
  /** component 专用 */
  component?: string
  props?: Record<string, unknown>
  /** externalModel 专用 */
  format?: 'glb' | 'gltf'
  url?: string
}

/** 场景基础信息 */
export interface DslSceneInfo {
  background?: string
  grid?: { enabled?: boolean; size?: number; divisions?: number }
  units?: string
  upAxis?: 'x' | 'y' | 'z'
}

/** 元信息 */
export interface DslMetadata {
  title?: string
  description?: string
  createdAt?: string
  generator?: string
  tags?: string[]
  [key: string]: unknown
}

/**
 * DSL 快照：可还原当前 3D 场景的 JSON。
 *
 * Code-first 下，DSL 是【衍生数据】：由运行后的 Object3D 场景提取而来，
 * 不是场景的渲染源，也不可反向控制场景。详见 docs/02、docs/03、docs/04。
 */
export interface DslSnapshot {
  version: string
  metadata?: DslMetadata
  scene?: DslSceneInfo
  camera?: DslCamera
  lights?: DslLight[]
  objects: DslObject[]
  /** 提取质量告警汇总（各节点 warnings 的扁平列表） */
  warnings?: DslWarningCode[]
}
