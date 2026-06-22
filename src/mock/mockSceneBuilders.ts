/**
 * mock 场景代码生成器（Code-first，第 10 阶段）。
 *
 * 设计：以 MockSceneState（场景意图）为内部源 → describeMockScene 生成对象描述树 →
 * buildCreateSceneCode 产出 `createScene(THREE, ctx)` 函数文本（符合 docs/04 执行契约）。
 * 该文本会被：
 *   - 送进 sandbox iframe 真正执行（不再用受控工厂直接构造）；
 *   - 由 wrapAsStandaloneHtml 包装后展示在 HTML 代码页。
 *
 * ⚠️ 注意：本文件只生成代码【文本】，不 import three、不构造 Object3D。
 *
 * 符合 docs/04：每个对象带 userData(id/name/type)，稳定 id 跨轮保留。
 */

/** 场景意图状态（mock 的"当前场景"内部表示） */
export interface MockSceneState {
  hasPlayground: boolean
  hasHoop: boolean
  /** false=右侧，true=左侧 */
  hoopLeft: boolean
  hasTree: boolean
}

export const initialState: MockSceneState = {
  hasPlayground: false,
  hasHoop: false,
  hoopLeft: false,
  hasTree: false,
}

type GeoKind = 'Box' | 'Sphere' | 'Cylinder' | 'Cone' | 'Plane' | 'Torus' | 'Ring'

interface MockGeometry {
  kind: GeoKind
  args: number[]
}

interface MockObjDesc {
  id: string
  name: string
  type: 'primitive' | 'lowPolyComposite'
  geo?: MockGeometry
  color?: number
  position: number[]
  rotationDeg?: number[]
  children?: MockObjDesc[]
  /** 调试用：故意不标 userData，触发提取 warning */
  skipId?: boolean
}

const DEG = Math.PI / 180

/** 由场景意图生成对象描述树 */
export function describeMockScene(state: MockSceneState): MockObjDesc[] {
  const objects: MockObjDesc[] = []

  if (state.hasPlayground) {
    objects.push({
      id: 'ground_1', name: '操场地面', type: 'primitive',
      geo: { kind: 'Plane', args: [24, 16] }, color: 0x3a9d3a,
      position: [0, 0, 0], rotationDeg: [-90, 0, 0],
    })
    objects.push({
      id: 'track_1', name: '跑道', type: 'primitive',
      geo: { kind: 'Ring', args: [4, 5, 64] }, color: 0xc0432f,
      position: [0, 0.01, 0], rotationDeg: [-90, 0, 0],
    })
  }

  if (state.hasHoop) {
    const x = state.hoopLeft ? -5 : 5
    objects.push({
      id: 'hoop_1', name: '篮球架', type: 'lowPolyComposite', position: [x, 0, 0],
      children: [
        { id: 'hoop_1_pole', name: '立柱', type: 'primitive', geo: { kind: 'Cylinder', args: [0.06, 0.06, 3, 24] }, color: 0xf5a623, position: [0, 1.5, 0] },
        { id: 'hoop_1_board', name: '篮板', type: 'primitive', geo: { kind: 'Box', args: [1.8, 1.1, 0.05] }, color: 0xffffff, position: [0, 2.9, 0.1] },
        { id: 'hoop_1_ring', name: '篮圈', type: 'primitive', geo: { kind: 'Torus', args: [0.23, 0.02, 16, 48] }, color: 0xe84a1f, position: [0, 2.6, 0.55], rotationDeg: [90, 0, 0] },
      ],
    })
  }

  if (state.hasTree) {
    objects.push({
      id: 'tree_1', name: '树', type: 'lowPolyComposite', position: [3, 0, -3],
      children: [
        { id: 'tree_1_trunk', name: '树干', type: 'primitive', geo: { kind: 'Cylinder', args: [0.15, 0.2, 1.2, 24] }, color: 0x8a5a2b, position: [0, 0.6, 0] },
        { id: 'tree_1_leaves', name: '树冠', type: 'primitive', geo: { kind: 'Cone', args: [0.7, 1.6, 24] }, color: 0x2e8b57, position: [0, 1.8, 0] },
      ],
    })
  }

  return objects
}

function hex(number: number): string {
  return '0x' + number.toString(16).padStart(6, '0')
}

function rad(deg: number): string {
  return (deg * DEG).toFixed(4)
}

function emitObj(desc: MockObjDesc, parentVar: string, indent: number): string {
  const pad = '  '.repeat(indent)
  const varName = desc.id
  const lines: string[] = []

  if (desc.type === 'lowPolyComposite') {
    lines.push(`${pad}const ${varName} = new THREE.Group()`)
    lines.push(`${pad}${varName}.position.set(${desc.position.join(', ')})`)
    if (!desc.skipId) {
      lines.push(`${pad}${varName}.userData = { id: '${desc.id}', name: '${desc.name}', type: 'lowPolyComposite' }`)
    }
    lines.push(`${pad}${parentVar}.add(${varName})`)
    for (const child of desc.children ?? []) lines.push(emitObj(child, varName, indent + 1))
  } else {
    const geo = desc.geo!
    lines.push(
      `${pad}const ${varName} = new THREE.Mesh(new THREE.${geo.kind}Geometry(${geo.args.join(', ')}), new THREE.MeshStandardMaterial({ color: ${hex(desc.color ?? 0xffffff)} }))`,
    )
    lines.push(`${pad}${varName}.position.set(${desc.position.join(', ')})`)
    if (desc.rotationDeg) {
      lines.push(`${pad}${varName}.rotation.set(${rad(desc.rotationDeg[0])}, ${rad(desc.rotationDeg[1])}, ${rad(desc.rotationDeg[2])})`)
    }
    if (!desc.skipId) {
      lines.push(`${pad}${varName}.userData = { id: '${desc.id}', name: '${desc.name}', type: 'primitive' }`)
    }
    lines.push(`${pad}${parentVar}.add(${varName})`)
  }
  return lines.join('\n')
}

/**
 * 生成 `createScene(THREE, ctx)` 函数文本（执行契约见 docs/04、docs/05）。
 * 该文本会被送进 sandbox iframe 执行，也会被 wrapAsStandaloneHtml 包装展示。
 */
export function buildCreateSceneCode(descs: MockObjDesc[]): string {
  const objectsCode = descs.length > 0
    ? '\n' + descs.map((desc) => emitObj(desc, 'scene', 1)).join('\n\n')
    : ''

  return `function createScene(THREE, ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f7);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(8, 6, 10);
  camera.userData = { id: 'camera_main', name: '主相机', type: 'camera', target: [0, 0.5, 0] };

  const grid = new THREE.GridHelper(20, 20, 0xbbbbbb, 0xdddddd);
  grid.userData = { dslIgnore: true };
  scene.add(grid);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  hemisphere.position.set(0, 20, 0);
  hemisphere.userData = { id: 'hemisphere_1', name: '环境光', type: 'light', lightType: 'hemisphere' };
  scene.add(hemisphere);
${objectsCode}
  return { scene, camera };
}`
}

/** 调试用：把第一个 primitive 标记为不标注（触发 missing_id/missing_type warning） */
export function markOneUnannotated(descs: MockObjDesc[]): boolean {
  for (const desc of descs) {
    if (desc.type === 'primitive') {
      desc.skipId = true
      return true
    }
    for (const child of desc.children ?? []) {
      if (child.type === 'primitive') {
        child.skipId = true
        return true
      }
    }
  }
  return false
}
