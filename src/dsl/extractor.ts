import type {
  DslCamera,
  DslGeometry,
  DslLight,
  DslMaterial,
  DslObject,
  DslObjectKind,
  DslObjectType,
  DslSceneInfo,
  DslSnapshot,
  DslTransform,
  DslUserData,
  DslWarningCode,
  Vec3,
  Vec4,
} from '@/types'
import type { SceneSnapshot, SnapshotMaterial, SnapshotNode } from '@/sandbox/protocol'

/**
 * 场景快照 → DSL 提取器。
 *
 * 输入是 sandbox iframe 内对"运行后 Object3D 场景"序列化得到的 SceneSnapshot（纯 JSON）。
 * DSL 是【衍生数据】：只读、不回流，不是渲染源。详见 docs/02、03、05。
 *
 * 提取规则（与 docs/04 一致）：id/name/type 取自 userData；缺 id 回退临时 id + warning；
 * 缺 type 回退 group + warning；light/camera 分别路由；dslIgnore 跳过；
 * rotation 弧度→度数，非单位四元数输出 quaternion；geometry/material 不可识别 warning。
 */

const DEG = 180 / Math.PI

interface ExtractContext {
  autoSeq: number
  warnings: DslWarningCode[]
}

function isIdentityQuaternion(q: Vec4): boolean {
  return q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1
}

function readUserData(raw: unknown): Partial<DslUserData> | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<DslUserData>
}

function readTransform(node: SnapshotNode): DslTransform {
  const out: DslTransform = {
    position: [node.position[0], node.position[1], node.position[2]],
  }
  const q = node.quaternion
  if (!isIdentityQuaternion(q)) {
    out.quaternion = [q[0], q[1], q[2], q[3]]
  } else {
    out.rotation = [node.rotation[0] * DEG, node.rotation[1] * DEG, node.rotation[2] * DEG]
  }
  const s = node.scale
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) {
    out.scale = [s[0], s[1], s[2]]
  }
  return out
}

function readGeometry(type: string, parameters: Record<string, number> | undefined, warnings: DslWarningCode[]): DslGeometry | undefined {
  const p = parameters
  switch (type) {
    case 'BoxGeometry': return { type: 'box', width: p?.width, height: p?.height, depth: p?.depth }
    case 'SphereGeometry': return { type: 'sphere', radius: p?.radius, segments: p?.widthSegments }
    case 'CylinderGeometry': return { type: 'cylinder', radiusTop: p?.radiusTop, radiusBottom: p?.radiusBottom, height: p?.height, segments: p?.radialSegments }
    case 'ConeGeometry': return { type: 'cone', radius: p?.radius, height: p?.height, segments: p?.radialSegments }
    case 'PlaneGeometry': return { type: 'plane', width: p?.width, height: p?.height }
    case 'TorusGeometry': return { type: 'torus', radius: p?.radius, tube: p?.tube, radialSegments: p?.radialSegments, tubularSegments: p?.tubularSegments }
    case 'RingGeometry': return { type: 'ring', innerRadius: p?.innerRadius, outerRadius: p?.outerRadius, segments: p?.thetaSegments }
    default:
      warnings.push('geometry_unknown')
      return undefined
  }
}

function readMaterial(material: SnapshotMaterial | null, warnings: DslWarningCode[]): DslMaterial | undefined {
  if (!material) return undefined
  const out: DslMaterial = {}
  switch (material.type) {
    case 'MeshBasicMaterial': out.type = 'basic'; break
    case 'MeshPhongMaterial': out.type = 'phong'; break
    case 'MeshStandardMaterial': out.type = 'standard'; break
    default:
      out.type = 'standard'
      warnings.push('material_unknown')
      break
  }
  if (material.color) out.color = material.color
  if (material.emissive) out.emissive = material.emissive
  if (material.metalness !== undefined) out.metalness = material.metalness
  if (material.roughness !== undefined) out.roughness = material.roughness
  if (material.opacity !== undefined && material.opacity !== 1) {
    out.opacity = material.opacity
    out.transparent = material.transparent
  }
  if (material.side === 1) out.side = 'back'
  else if (material.side === 2) out.side = 'double'
  return out
}

function objectKindOf(node: SnapshotNode): DslObjectKind {
  if (node.isMesh) return 'mesh'
  if (node.isLight) return 'light'
  if (node.isCamera) return 'camera'
  if (node.threeType === 'Group') return 'group'
  return 'other'
}

function readLightNode(node: SnapshotNode, ctx: ExtractContext): DslLight {
  const ud = readUserData(node.userData)
  const warnings: DslWarningCode[] = []
  const light = node.light

  const out: DslLight = {
    id: ud?.id ?? (() => {
      ctx.autoSeq += 1
      warnings.push('missing_id')
      return `auto_light_${ctx.autoSeq}`
    })(),
    type: (ud?.lightType ?? 'ambient') as DslLight['type'],
    ...readTransform(node),
  }
  if (light?.intensity !== undefined) out.intensity = light.intensity
  if (light?.color) out.color = light.color
  if (light?.castShadow) out.castShadow = true

  if (warnings.length > 0) {
    out.warnings = warnings
    ctx.warnings.push(...warnings)
  }
  return out
}

function readCameraNode(node: SnapshotNode): DslCamera {
  const ud = readUserData(node.userData)
  const warnings: DslWarningCode[] = []
  const target = (ud?.target ?? [0, 0, 0]) as Vec3

  const out: DslCamera = {
    id: ud?.id ?? (() => {
      warnings.push('missing_id')
      return 'auto_camera'
    })(),
    type: 'perspective',
    position: [node.position[0], node.position[1], node.position[2]],
    target,
    rotation: [node.rotation[0] * DEG, node.rotation[1] * DEG, node.rotation[2] * DEG],
    fov: node.camera?.fov ?? 60,
    near: node.camera?.near,
    far: node.camera?.far,
  }
  if (warnings.length > 0) out.warnings = warnings
  return out
}

/** 递归读取对象节点（light/camera/dslIgnore 不进 objects） */
function readObjectNode(node: SnapshotNode, ctx: ExtractContext): DslObject | null {
  const ud = readUserData(node.userData)
  if (ud?.dslIgnore === true) return null
  if (ud?.type === 'light' || ud?.type === 'camera') return null

  const objectKind = objectKindOf(node)
  const warnings: DslWarningCode[] = []

  const hasType = ud?.type !== undefined
  const type = (ud?.type ?? 'group') as DslObjectType
  if (!hasType) warnings.push('missing_type')

  const id = ud?.id ?? (() => {
    ctx.autoSeq += 1
    warnings.push('missing_id')
    return `auto_${objectKind}_${ctx.autoSeq}`
  })()

  const dslNode: DslObject = {
    id,
    name: ud?.name ?? undefined,
    type,
    objectKind,
    ...readTransform(node),
  }
  if (node.visible === false) dslNode.visible = false

  if (node.isMesh) {
    const geometry = node.geometry
      ? readGeometry(node.geometry.type, node.geometry.parameters, warnings)
      : undefined
    if (geometry) dslNode.geometry = geometry
    const material = readMaterial(node.material, warnings)
    if (material) dslNode.material = material
  }

  const children: DslObject[] = []
  for (const child of node.children) {
    const childNode = readObjectNode(child, ctx)
    if (childNode) children.push(childNode)
  }
  if (children.length > 0) dslNode.children = children

  if (warnings.length > 0) {
    dslNode.warnings = warnings
    ctx.warnings.push(...warnings)
  }
  return dslNode
}

export function extractDslFromSnapshot(snapshot: SceneSnapshot): DslSnapshot {
  const ctx: ExtractContext = { autoSeq: 0, warnings: [] }
  const lights: DslLight[] = []
  const objects: DslObject[] = []

  for (const node of snapshot.rootNodes) {
    const ud = readUserData(node.userData)
    if (ud?.dslIgnore === true) continue
    if (ud?.type === 'light') {
      lights.push(readLightNode(node, ctx))
      continue
    }
    if (ud?.type === 'camera') continue
    const objectNode = readObjectNode(node, ctx)
    if (objectNode) objects.push(objectNode)
  }

  const sceneInfo: DslSceneInfo = {}
  if (snapshot.background) sceneInfo.background = snapshot.background

  const out: DslSnapshot = {
    version: '0.2',
    scene: sceneInfo,
    camera: snapshot.camera ? readCameraNode(snapshot.camera) : undefined,
    lights,
    objects,
  }
  if (ctx.warnings.length > 0) out.warnings = ctx.warnings
  return out
}
