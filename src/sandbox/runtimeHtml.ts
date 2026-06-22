/**
 * sandbox iframe 的运行时 srcdoc 模板（固定，不含 LLM 代码）。
 *
 * 职责：加载 three -> 监听主应用的 run/dispose -> 执行 createScene(THREE, ctx) ->
 * 渲染 -> 遍历运行后场景生成 SceneSnapshot -> postMessage 回传 ready/error。
 *
 * 安全：iframe sandbox="allow-scripts"（无 allow-same-origin）；
 * CSP 禁网络(connect-src 'none')，仅放行 three CDN 与执行所需的 unsafe-eval/inline。
 */
export function buildSandboxRuntimeHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';" />
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

const host = parent;
let renderer = null, controls = null, currentScene = null, raf = 0, resizeHandler = null;

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

function disposeCurrent() {
  if (raf) cancelAnimationFrame(raf); raf = 0;
  if (resizeHandler) { removeEventListener('resize', resizeHandler); resizeHandler = null; }
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
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    renderer = null;
  }
}

function run(code, runId) {
  try {
    disposeCurrent();
    // 在沙箱内执行 LLM 代码字符串：定义 createScene 并调用（隔离由 sandbox 保证）
    const build = new Function('THREE', 'ctx', String(code) + '\\n;return createScene(THREE, ctx);');
    const built = build(THREE, {});
    const scene = built.scene;
    const camera = built.camera;
    if (!scene || !camera) throw new Error('createScene 未返回 { scene, camera }');
    currentScene = scene;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    const t = (camera.userData && camera.userData.target) || [0, 0, 0];
    controls.target.set(t[0], t[1], t[2]);
    controls.enableDamping = true;

    resizeHandler = function () {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', resizeHandler);

    function loop() { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }
    raf = requestAnimationFrame(loop);

    host.postMessage({ type: 'ready', runId: runId, snapshot: snapshot(scene, camera) }, '*');
  } catch (err) {
    disposeCurrent();
    host.postMessage({ type: 'error', runId: runId, message: (err && err.message) || String(err), stack: (err && err.stack) || '' }, '*');
  }
}

window.addEventListener('message', function (e) {
  const data = e.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'run') run(data.code, data.runId);
  else if (data.type === 'dispose') disposeCurrent();
});

host.postMessage({ type: 'runtime-ready' }, '*');
</script>
</body>
</html>`
}
