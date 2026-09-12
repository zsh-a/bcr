# @bcr/scene-renderer

浏览器端的通用静态场景渲染与图片导出库。用独立于 Three.js 的场景描述定义几何体、材质、灯光和相机，输出 PNG、JPEG 或 WebP。支持 WebGPU，并在不可用时回退到 WebGL 2。

纸张、账单、商品或卡片都由调用方组合场景。库本身不包含业务模板、纸张预设或 React 依赖。docgen 的接入示例位于 `packages/docgen-core/src/photo-scene.ts`。

```ts
import { renderScene } from "@bcr/scene-renderer";

const result = await renderScene(
  {
    objects: [
      {
        geometry: { kind: "box", width: 0.18, height: 0.12, depth: 0.08 },
        position: [0, 0, 0.04],
        material: { color: "#236980", roughness: 0.35 },
      },
      {
        geometry: { kind: "plane", width: 4, height: 4 },
        material: { color: "#c9ccd0", roughness: 0.8 },
        frame: false,
        castShadow: false,
      },
    ],
    lights: [
      { kind: "hemisphere", sky: "#ebf1ff", ground: "#a1a2a5", intensity: 1.5 },
      {
        kind: "directional",
        position: [-0.4, 0.5, 0.8],
        intensity: 3,
        shadow: { radius: 3 },
      },
    ],
    camera: { kind: "auto", direction: [0.25, -0.7, 1], padding: 0.18 },
  },
  {
    size: { width: 1200, height: 900 },
    format: "image/png",
  },
);

// result: { blob, width, height, backend }
```

## 批量渲染

`renderScene()` 自动创建并释放渲染器。批量工作使用一个实例，所有请求自动串行，避免输出画布互相覆盖：

```ts
import { createSceneRenderer } from "@bcr/scene-renderer";

const renderer = await createSceneRenderer({ backend: "auto" });
try {
  const first = await renderer.render(sceneA, { format: "image/jpeg" });
  const second = await renderer.render(sceneB, { format: "image/webp" });
} finally {
  await renderer.dispose();
}
```

`dispose()` 等待已接受的请求完成后释放资源，可以重复调用；开始释放后拒绝新请求。单次渲染失败会清理该帧的资源，后续请求仍可继续。

## 场景约定

| 能力     | 接口                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| 几何体   | `plane`、`box`、`sphere`、`mesh` 自定义三角网格                                     |
| 材质     | 基础颜色、颜色贴图、粗糙度、金属度、法线图、凹凸图、粗糙度图                        |
| 图像输入 | 已解码的 `HTMLImageElement`、`ImageBitmap`、Canvas、OffscreenCanvas、RGBA8 像素数据 |
| 灯光     | 环境光、半球光、带阴影的平行光、点光源                                              |
| 相机     | 自动透视取景，或显式位置/目标的透视相机                                             |
| 输出     | 尺寸、格式、质量、曝光、色调映射、全画面暗角和颗粒                                  |

尺寸使用米，旋转使用弧度。平面位于 XY，正面朝 +Z；自定义网格按逆时针定义正面。`frame: false` 让桌面等背景物体参与渲染但不影响自动取景。自动相机覆盖经过变换的主体三维范围，同时考虑输出横纵比。

颜色贴图按 sRGB 读取，法线、凹凸、粗糙度图作为线性数据；光照在线性空间计算，在导出时统一映射到 sRGB。原始 RGBA 数据的第一行对应网格 UV 的 v=0。DOM 图像自动统一方向。

输入图片和网格数组由调用方拥有。渲染完成前保持场景描述和输入不变，库不会关闭调用方的 `ImageBitmap`。输出尺寸范围为每边 64–4096 像素，图像纹理长边最多上传 4096 像素。

库入口在 Node 中可安全导入；渲染器在浏览器中按需加载。`seed` 控制后处理颗粒，同一后端上的相同场景可复现；不同 GPU/浏览器的浮点和图像编码结果不保证逐字节一致。

## 验证

```sh
bun run typecheck
bun x vp test run packages/scene-renderer/tests
# 先启动 bun run docgen，再运行浏览器验证：
node scripts/verify-scene-renderer.mjs
```

浏览器验证覆盖 WebGPU、强制 WebGL 2、无 WebGPU 时自动回退、纸张与商品场景、不同图像输入的方向、横竖尺寸、三种导出格式、重复渲染和资源生命周期。产物默认写入 `/tmp/bcr-scene-renderer`。可通过 `BCR_SCENE_URL`、`BCR_SCENE_OUTPUT`、`BCR_BROWSER_PATH` 指定运行环境。

`node scripts/verify-docgen-photo.mjs` 另外验证 docgen 场景选择、预览下载和全部 12 个模板的生成链路。
