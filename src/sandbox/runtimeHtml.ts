/**
 * sandbox iframe 的运行时 srcdoc 模板（固定，不含 LLM 代码）。
 *
 * 职责：加载 three -> 监听主应用的 run/dispose -> 执行 createScene(THREE, ctx) ->
 * 渲染 -> 遍历运行后场景生成 SceneSnapshot -> postMessage 回传 ready/error。
 *
 * 安全：iframe sandbox="allow-scripts"（无 allow-same-origin）；
 * CSP 禁网络(connect-src 'none')，仅放行 three CDN 与执行所需的 unsafe-eval/inline。
 */
import { componentBootstrapSource } from '@/scene-components/registry'

export function buildSandboxRuntimeHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; img-src data: blob:; connect-src blob:;" />
<style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.171.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.171.0/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 组件工厂 bootstrap：在 THREE 作用域构建 ctx.components（见 registry.componentBootstrapSource）
${componentBootstrapSource()}

const host = parent;
let renderer = null, controls = null, currentScene = null, currentCamera = null, raf = 0, resizeHandler = null;

// 混元 GLB 注入：主进程预生成后经 postMessage 'inject-assets' 把 ArrayBuffer 注入 window.__preloadedModels；
// createScene 内用 ctx.getModel(key) 经 GLTFLoader.parse 解析（纯内存，不触网、不被静态检查拦）。
// 混元产物无 Draco/meshopt 压缩，裸 GLTFLoader 可直接 parse。
const __gltfLoader = new GLTFLoader();
let __parsedCache = {};
window.__preloadedModels = {};
async function __getModel(key) {
  var buf = window.__preloadedModels && window.__preloadedModels[key];
  if (!buf) return null;                       // 未注入 / 生成失败 → null，createScene 走几何兜底
  if (__parsedCache[key]) return __parsedCache[key].clone(true);
  var gltf = await new Promise(function (resolve, reject) {
    __gltfLoader.parse(buf, '', resolve, reject);
  });
  __parsedCache[key] = gltf.scene;
  return gltf.scene.clone(true);
}

function cloneSimple(obj) {
  const out = {};
  for (const k in obj) {
    const v = obj[k];
    if (typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}
function snapGeo(g) { return g ? { type: g.type, parameters: g.parameters || undefined } : null; }
function snapMat(m) {
  const a = Array.isArray(m) ? m[0] : m;
  if (!a) return null;
  return {
    type: a.type,
    color: a.color ? ('#' + a.color.getHexString()) : undefined,
    emissive: a.emissive ? ('#' + a.emissive.getHexString()) : undefined,
    metalness: a.metalness,
    roughness: a.roughness,
    opacity: a.opacity,
    transparent: a.transparent,
    side: a.side
  };
}
function snapObj(o) {
  const node = {
    userData: (o.userData && typeof o.userData === 'object') ? cloneSimple(o.userData) : null,
    threeType: o.type,
    isMesh: !!o.isMesh,
    isLight: !!o.isLight,
    isCamera: !!o.isCamera,
    position: [o.position.x, o.position.y, o.position.z],
    rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
    quaternion: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
    scale: [o.scale.x, o.scale.y, o.scale.z],
    visible: o.visible,
    geometry: null,
    material: null,
    children: []
  };
  if (node.isMesh) { node.geometry = snapGeo(o.geometry); node.material = snapMat(o.material); }
  if (node.isLight) { node.light = { intensity: o.intensity, color: o.color ? ('#' + o.color.getHexString()) : undefined, castShadow: !!o.castShadow }; }
  if (node.isCamera) { node.camera = { fov: o.fov, near: o.near, far: o.far }; }
  for (const c of o.children) node.children.push(snapObj(c));
  return node;
}
function snapshot(scene, camera) {
  const rootNodes = [];
  for (const c of scene.children) rootNodes.push(snapObj(c));
  return {
    background: (scene.background && scene.background.getHexString) ? ('#' + scene.background.getHexString()) : null,
    camera: camera ? snapObj(camera) : null,
    rootNodes: rootNodes
  };
}

// 渲染循环：渲染当前 currentScene/currentCamera（切换场景时自动跟进）
function loop() {
  raf = requestAnimationFrame(loop);
  if (controls) controls.update();
  if (renderer && currentScene && currentCamera) renderer.render(currentScene, currentCamera);
}

// 确保 renderer/canvas/resize/loop 存在（跨多次 run 复用，不重复创建）
function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  resizeHandler = function () {
    if (currentCamera) { currentCamera.aspect = innerWidth / innerHeight; currentCamera.updateProjectionMatrix(); }
    if (renderer) renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', resizeHandler);
  raf = requestAnimationFrame(loop);
}

// 仅回收场景对象与 controls（保留 renderer，供下一次 run 复用）
function disposeScene() {
  if (controls) { controls.dispose(); controls = null; }
  if (currentScene) {
    currentScene.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach(function (x) { if (x && x.dispose) x.dispose(); });
      else if (m && m.dispose) m.dispose();
    });
    currentScene = null;
  }
  currentCamera = null;
}

// 完全销毁（仅 'dispose' 消息用）
function disposeCurrent() {
  if (raf) cancelAnimationFrame(raf); raf = 0;
  if (resizeHandler) { removeEventListener('resize', resizeHandler); resizeHandler = null; }
  disposeScene();
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    renderer = null;
  }
}

async function run(code, runId) {
  // 关键：先构建新场景，成功才切换并回收旧的；失败则原样保留旧场景（不黑屏）
  // createScene 可为 async（如 await ctx.getModel 内部 GLTFLoader.parse）；await 对同步返回兼容。
  let newScene, newCamera;
  try {
    const ctx = { components: __buildComponents(THREE), getModel: __getModel };
    const build = new Function('THREE', 'ctx', String(code) + '\\n;return createScene(THREE, ctx);');
    const built = await build(THREE, ctx);
    newScene = built && built.scene;
    newCamera = built && built.camera;
    if (!newScene || !newCamera) throw new Error('createScene 未返回 { scene, camera }');
  } catch (err) {
    // 失败：保留旧场景与渲染，不黑屏；仅回传错误
    var errName = (err && err.name) ? (err.name + ': ') : '';
    var errMsg = err ? (errName + (err.message || String(err))) : String(err);
    host.postMessage({ type: 'error', runId: runId, message: errMsg, stack: (err && err.stack) || '' }, '*');
    return;
  }

  // 成功：切换到新场景（回收旧场景对象，复用 renderer）
  disposeScene();
  currentScene = newScene;
  currentCamera = newCamera;
  ensureRenderer();
  controls = new OrbitControls(newCamera, renderer.domElement);
  const t = (newCamera.userData && newCamera.userData.target) || [0, 0, 0];
  controls.target.set(t[0], t[1], t[2]);
  controls.enableDamping = true;

  host.postMessage({ type: 'ready', runId: runId, snapshot: snapshot(newScene, newCamera) }, '*');
}

window.addEventListener('message', function (e) {
  const data = e.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'run') run(data.code, data.runId);
  else if (data.type === 'dispose') disposeCurrent();
  else if (data.type === 'inject-assets') {
    // 主进程注入本轮预生成的 GLB ArrayBuffer；清缓存强制按新数据重 parse
    window.__preloadedModels = data.models || {};
    __parsedCache = {};
    host.postMessage({ type: 'assets-ready' }, '*');
  }
});

host.postMessage({ type: 'runtime-ready' }, '*');
</script>
</body>
</html>`
}
