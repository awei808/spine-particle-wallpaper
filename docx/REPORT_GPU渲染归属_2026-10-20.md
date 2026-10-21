# WE 壁纸「渲染跑在 CPU 上」· 实测归因报告

- 日期：2026-10-20
- 机器：笔记本，AMD Radeon 核显 + NVIDIA RTX 4060 Laptop（8GB，驱动 591.59），内屏 2560×1600@165Hz
- 对象：WE 工程 `myprojects/星语心恋S8`（配置基线 `1700×750`，`dpr:auto`，13 层：4 texture + 6 spine + 3 particle）
- WE 全局设置：`fps: 30`，`uihardwareacceleration: true`
- 结论一句话：**GPU 在干活，但干的是核显；每帧真正的时间确实主要花在 CPU 侧的提交上（21ms/帧 vs GPU 7.8ms/帧）。独显不参与是设计使然，强行拉进来零收益。**

---

## 1. 实测数据（12s × 3 次采样，结果可重复）

进程树：`browser pid=7372` / `gpu-process pid=14052` / `renderer pid=11572` / `wallpaper32 pid=4284`

| 指标 | 第 1 次 | 第 2 次 | 第 3 次 |
|---|---|---|---|
| GPU 3D 引擎（luid `0xe300`） | 23.09% | 23.16% | 23.30% |
| copy / video / compute 引擎 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| renderer CPU | 41.5% 单核 | 33.7% | 34.2%（≈11.4 ms/帧） |
| gpu-process CPU | 33.1% 单核 | 31.5% | 28.5%（≈9.5 ms/帧） |
| browser + wallpaper32 | 1.7% + 1.3% | 4.0% + 1.2% | 0.7% + 0.4% |
| NVIDIA 独显 | 0%，占用 3 MiB，进程列表里只有 Steam | — | — |

> 换算：CPU% × 10 / fps = ms/帧。30fps 下 1% 单核 = 0.33 ms/帧。

**每帧预算（30fps ⇒ 33.3 ms）：**

```
GPU 忙      7.8 ms  (23.3% × 33.3)
renderer   11.4 ms  ┐
gpu-process 9.5 ms  ┴ 合计 20.9 ms，两进程并行，关键路径约 11~15 ms
独显        0.0 ms
```

---

## 2. 判定证据链：渲染在「核显的硬件 D3D11」上

1. **GPU 进程加载的图形后端 DLL**（`Get-Process -Id 14052).Modules`）
   - 有：`libEGL.dll` / `libGLESv2.dll`（ANGLE）、`d3d11.dll`、**`atidxx64.dll`（AMD D3D11 用户态驱动）**
   - 无：`nvwgf2umx.dll`（NVIDIA UMD）⇒ 设备不在 4060 上
   - 无：`d3d10warp.dll`（WARP 软光栅）
2. **显存驻留**：`\GPU Process Memory(pid_14052_luid_0x..._0x0000e300_phys_0)\Local Usage = 340.4 MB`，即 340MB 纹理实实在在躺在那块适配器的显存里。该 luid 专用显存共 401MB；NVIDIA（luid `0xfd21`）只有 6.2MB（Steam 的）。
3. **引擎类型**：只有 `engtype_3d` 有占用，`copy`/`video`/`compute` 全 0 ⇒ 是真光栅化，不是「软件画完再拷一次」。
4. **排除 SwiftShader**：`vk_swiftshader.dll` 确实被加载（ANGLE 兜底库，加载≠启用）。若真走软光栅，要撑起同等像素率需要 8 核以上满载，实测 gpu 进程只用了 0.29 核、renderer 0.34 核，差一个数量级。
5. **填充率反算与实测吻合**：4 张背景≈满屏（2560×1600 = 4.1MP×4）+ 6 个骨架（≈0.6 屏/个）+ 3 组粒子 ≈ 26 MP/帧；30fps ⇒ 约 0.8 Gpx/s。Radeon 780M 级核显填充率约 7~8 Gpx/s ⇒ 理论 10~12%，叠加 alpha 混合的读改写与 overdraw 后落在 23%，同一量级。

**结论：不存在「CPU 光栅化」。** 那 0.29 + 0.34 核是 JS/顶点计算 + ANGLE→D3D11 的提交开销。

---

## 3. 独显为什么完全不动（三层原因，都是正常现象）

1. **硬件层**：内屏接在核显上。`Win32_VideoController` 里只有 AMD 有 `VideoModeDescription`，`nvidia-smi display_active = Disabled`。混合输出（无 MUX 直连）的笔记本，桌面合成天然落在核显。
2. **系统层**：`HKCU\...\DirectX\UserGpuPreferences` 里没有 `webwallpaper64.exe` 条目 ⇒ 走「让 Windows 决定」⇒ 核显。微软文档明确：**WebGL 经 ANGLE 时，GPU 选择交给 Windows 图形首选项，默认核显**；早年的 OpenGL 上下文才会默认挑独显。这是 CEF 类应用的通病，不是本项目的 bug。
3. **WE 设计层**：官方帮助中心（`help.wallpaperengine.io/zh/performance/dwm.html`）写得很直白——壁纸是 Explorer 桌面进程的一部分，**必须和 Explorer 用同一块 GPU**；改用另一块卡会让 Windows 被迫在两个 GPU 之间搬图，「这一操作的速度非常缓慢」，而且「往往要耗费比壁纸本身多很多的性能」。开发者 Tim 在 Steam 讨论区也是同一口径：应始终跑在接屏幕的那块卡上。

**推论：把渲染换到 4060 不会有任何提速。** 因为瓶颈在 CPU 侧提交（20.9ms/帧），不在光栅化（7.8ms/帧），换卡等于给非瓶颈加速，还要额外付一次跨卡合成。

---

## 4. 为什么会有「交给 CPU」的观感

1. **旧结论的来源**：`docx/_archive/2026-10/REPORT_WE_CPU占用归因_2026-10-19.md` 第 1 节自述测试环境是 **headless Chrome + SwiftShader 软渲染**。那组「CPU 在填充率，不在 JS」的结论在那套环境下成立，但它量的是**软件光栅**——不能外推到 WE 的硬件渲染路径。这是最可能造成误判的地方。
2. **任务管理器的读法**：进程「GPU」列是归一化值，且要展开「GPU 引擎」列才看得清落在 `GPU 0 - 3D` 还是 `GPU 1 - 3D`；混合输出机器上只看总数很容易读成 0。准确读数用第 5 节的命令。
3. **但你的直觉有一半是对的**：每帧 21ms 的 CPU 侧开销 vs 7.8ms 的 GPU 忙时，**这个壁纸确实是 CPU 提交受限**（6 个 Spine 骨架的顶点计算 + three.js 的 buffer 上传 + ANGLE 的命令翻译）。说「瓶颈在 CPU」成立，说「光栅化在 CPU」不成立。

---

## 5. 自己复核的命令

```powershell
# 各 GPU 引擎实时占用（luid 0xe300 = 核显，0xfd21 = 4060）
Get-Counter '\GPU Engine(*)\Utilization Percentage' |
  Select-Object -ExpandProperty CounterSamples |
  Where-Object { $_.CookedValue -gt 1 } |
  Select-Object InstanceName, @{n='Pct';e={[math]::Round($_.CookedValue,2)}}

# 纹理落在哪块卡（MB）
Get-Counter '\GPU Process Memory(*)\Local Usage' |
  Select-Object -ExpandProperty CounterSamples |
  Where-Object { $_.CookedValue -gt 50000000 } |
  Select-Object InstanceName, @{n='MB';e={[math]::Round($_.CookedValue/1MB,1)}}

# 一键复测（CPU ms/帧 + GPU 引擎占用）
powershell -File "D:\手游文件夹\spine-wallpaper-engine\_regress\gpu_sample.ps1"
```

另一个更直接的通道：WE 的 `config.json` 里已经有 `"cefcommandline": "--remote-debugging-port=9222"`，但**当前没生效**——webwallpaper 进程 22:11 启动，配置 22:21 才改。重启 WE 后 `curl http://127.0.0.1:9222/json` 就能连进页面，直接读 `WEBGL_debug_renderer_info` 的 `UNMASKED_RENDERER_WEBGL` 字符串（预期形如 `ANGLE (AMD, AMD Radeon(TM) Graphics ..., Direct3D11 vs_5_0 ps_5_0, D3D11)`）。顺带还能量真实 rAF 帧率、draw call 数。

---

## 6. 想真正降开销，动哪里

按实测收益排序（GPU 只用了 23%，别在显卡上折腾）：

| 手段 | 影响 | 备注 |
|---|---|---|
| `dpr` 降到 0.8~0.85 | 像素数 −28%~−36%，GPU 与混合带宽同步下降 | 2560×1600 上画质损失可接受，最划算的一刀 |
| 减全屏背景层 | 每少一层满屏 ≈ 4.1MP/帧（≈16% 填充率） | 4 张背景里若有可合并的，收益立竿见影 |
| 保持 WE `fps:30` | 已生效。30→60 等于 GPU 翻倍到 46% | 对呼吸/待机动画 30fps 足够 |
| 关 MSAA | 已关（`antialias` 缺省 false） | 想再省优先降 dpr，两者是相乘关系 |

若确实要试独显（不建议，仅为验证）：Windows 设置 → 系统 → 显示 → 显卡 → 添加 `webwallpaper64.exe` → 高性能 → 完全重启 WE；或在 `cefcommandline` 后追加 `--force-high-performance-gpu`（Chromium 原生开关，等价 `force_low_power_gpu` 的反面）。验证方式同上，看 `nvidia-smi` 与 luid 是否换到 `0xfd21`。预期：GPU 占用挪到独显，**CPU 帧成本不降反升**（多一次跨卡合成），风扇更响。

---

## 7. 一句话总结

渲染没交给 CPU：WebGL 经 ANGLE 跑在 **AMD 核显的 D3D11 硬件路径**上（3D 引擎 23%、显存驻留 340MB、AMD UMD 在使用中）。独显闲置是因为内屏接核显 + CEF 默认选核显 + WE 官方要求与桌面同卡。真正值得优化的是 **CPU 侧每帧 21ms 的提交开销**和 **2560×1600 的填充率**，而不是显卡选择。
