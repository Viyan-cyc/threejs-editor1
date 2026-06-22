import type { ComponentEntry } from './registry'

/**
 * mock Shelf 货架组件：4 根立柱 + 可调层数层板。
 *
 * factorySource 是一段在沙箱内执行的 JS 源码：接收 (THREE, params)，返回一个 THREE.Group。
 * 它会被 componentBootstrapSource() 注入到 sandbox runtime 与 standalone HTML。
 */
export const shelfEntry: ComponentEntry = {
  componentType: 'Shelf',
  name: '货架',
  description: '多层仓储货架：4 根立柱 + 可调层数层板。用于仓库 / 工厂 / 超市场景。',
  paramsSchema: {
    levels: { type: 'number', description: '层板层数', default: 4 },
    width: { type: 'number', description: '货架宽度', default: 2 },
    depth: { type: 'number', description: '货架进深', default: 0.6 },
    height: { type: 'number', description: '货架总高', default: 3 },
    color: { type: 'number', description: '材质颜色（hex 数字）', default: 0x8a6d3b },
  },
  exampleUsage: `const shelf = ctx.components.Shelf({ levels: 4, width: 2, height: 3, color: 0x8a6d3b })
shelf.position.set(0, 0, 0)
shelf.userData = { id: 'shelf_1', name: '货架', type: 'component', componentType: 'Shelf', params: { levels: 4, width: 2 }, description: '货架' }
scene.add(shelf)`,
  factorySource: `function (THREE, params) {
  params = params || {}
  var levels = params.levels || 4
  var width = params.width || 2
  var depth = params.depth || 0.6
  var height = params.height || 3
  var color = params.color || 0x8a6d3b
  var group = new THREE.Group()
  var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7 })
  var postGeo = new THREE.BoxGeometry(0.08, height, 0.08)
  var hx = width / 2
  var hz = depth / 2
  var corners = [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]]
  for (var i = 0; i < corners.length; i++) {
    var p = new THREE.Mesh(postGeo, mat)
    p.position.set(corners[i][0], height / 2, corners[i][1])
    group.add(p)
  }
  var boardGeo = new THREE.BoxGeometry(width, 0.05, depth)
  for (var j = 0; j <= levels; j++) {
    var b = new THREE.Mesh(boardGeo, mat)
    b.position.set(0, (j / levels) * height, 0)
    group.add(b)
  }
  return group
}`,
}
