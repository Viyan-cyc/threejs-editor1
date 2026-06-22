/**
 * 将 createScene(THREE, ctx) 源码包装为"完整可独立运行的 HTML"，
 * 用于 HTML 代码页展示（使用 Three.js ES Module + import map）。
 *
 * 会注入组件 bootstrap，使含 `ctx.components.<Type>(...)` 调用的代码也能独立运行。
 * 注意：此包装仅用于【展示/复制】，不在主应用执行；执行走 sandbox iframe。
 */
import { componentBootstrapSource } from '@/scene-components/registry'

export function wrapAsStandaloneHtml(createSceneCode: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Three.js Scene</title>
    <style>html, body { margin: 0; height: 100%; } body { overflow: hidden; }</style>
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

      // ===== 组件工厂 bootstrap =====
      ${componentBootstrapSource()}

      // ===== 场景源码（createScene） =====
      ${createSceneCode}

      // ===== 启动 =====
      const ctx = { components: __buildComponents(THREE) };
      const { scene, camera } = createScene(THREE, ctx);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      document.body.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      const target = (camera.userData && camera.userData.target) || [0, 0, 0];
      controls.target.set(target[0], target[1], target[2]);
      controls.enableDamping = true;

      addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
      });

      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });
    </script>
  </body>
</html>`
}
