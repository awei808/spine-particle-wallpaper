/**
 * @license
 * Spine Wallpaper Engine. This is a Spine animation player for wallpaper engine.
 * Copyright (C) 2023 Spicy Wolf
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as THREE from 'three';
import { TextureMeshConfig } from '@src/config.type';
import * as Scene from '@src/initScene';

/**
 * from example: https://stemkoski.github.io/Three.js/Texture-Animation.html
 */
export class TextureAnimator {
  private texture: THREE.Texture;
  private tilesHorizontal: number;
  private tilesVertical: number;
  private numberOfTiles: number;
  private tileDisplayDuration: number;
  private currentDisplayTime: number;
  private currentTile: number;
  /** 承载平面（自转要改它的 `rotation.z`） */
  private textureMesh: THREE.Mesh;
  /** 自转角速度（度/秒，带符号；0 = 不自转） */
  private spinDegPerSec: number;

  /**
   *
   * @param meshConfig
   * @param texture
   */
  constructor(meshConfig: TextureMeshConfig, texture: THREE.Texture) {
    if (!texture) {
      throw 'texture does not fully loaded';
    }
    // [MODIFIED] 原模板为 { map, side: DoubleSide, alphaTest: 1 }。
    // alphaTest:1 会让着色器丢弃一切 a < 1.0 的片元（three r149 的 alphatest_fragment），
    // 于是"半透明贴图"被硬边裁掉：实测 13 张分层背景里 _05/_08 会 100% 消失、
    // _01/_10/_11/_14 等丢 85~90% 像素，只有近乎不透明的 _12 能看。
    // 分层背景必须走标准透明混合，故改为 transparent + 关 alphaTest + 不写深度。
    // 注意：本套分层图是**直通 alpha（非预乘）**存储，因此不需要反转预乘，
    // 保持 three 默认（texture.premultiplyAlpha=false / material.premultipliedAlpha=false）即正确。
    var material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      alphaTest: 0,
    });
    var geometry = new THREE.PlaneGeometry(
      meshConfig?.width,
      meshConfig?.height,
      1,
      1
    );
    geometry.scale(
      meshConfig.scale ?? 1,
      meshConfig.scale ?? 1,
      meshConfig.scale ?? 1
    );
    var textureMesh = new THREE.Mesh(geometry, material);
    textureMesh.position.set(
      meshConfig?.position?.x ?? 0,
      meshConfig?.position?.y ?? 0,
      meshConfig?.position?.z ?? -1000
    );
    Scene.scene?.add(textureMesh);

    this.texture = texture;
    this.tilesHorizontal = meshConfig?.tilesHorizontal ?? 1;
    this.tilesVertical = meshConfig?.tilesVertical ?? 1;
    this.numberOfTiles = meshConfig?.numTiles ?? 1;
    this.tileDisplayDuration = meshConfig?.tileDisplayDuration ?? 0;
    // ★ 自转（可选）。`PlaneGeometry` 以平面中心为原点 ⇒ `rotation.z`
    //   就是绕贴图中心转，与 Unity UI 的 pivot=(0.5,0.5) 一致，无需额外偏移。
    this.textureMesh = textureMesh;
    this.spinDegPerSec = meshConfig?.spinDegPerSec ?? 0;

    /**
     * ★★ 边缘寻址必须是 **`ClampToEdgeWrapping`**，不能是 `RepeatWrapping`（2026-10-11 修）。
     *
     * ## 为什么
     *
     * 平面几何的 UV 恰好走在 `[0,1]` 上，而 GPU 双线性采样在**最边缘那一像素**会取到
     * `v<0` / `v>1` 的 texel。`RepeatWrapping` 会把它们**环绕到贴图对面那一行/列** ——
     * 于是"贴图顶行的颜色"与"贴图底行的颜色"在边缘被混成一个值。只要这两行颜色不同，
     * 画面上就会出现**一条与内容无关的 1px 线**，颜色由两张边缘共同决定。
     *
     * ## 实测（S9 盛夏游乐场 `Asuna_S9_Background_01.png`，1700×1163）
     *
     * · 顶行 `RGB=[17,12,14] α=0`、底行 `RGB=[217,208,174] α=250`
     *   ⇒ 环绕混合出 `α≈125` 的暗色；
     * · 该层**上边缘**投影到屏幕时（长宽比小、按宽基准 ⇒ 可见高大 ⇒ 上边缘进入画面）
     *   就横贯整幅出现一条**淡灰线**；
     * · 逐层屏蔽实证：把这一层换成透明图 ⇒ 线消失；屏蔽其余各层 ⇒ 无变化。
     * · 游戏画幅（2.2667）下该边缘在画外 ⇒ 实录里看不到，与用户观察一致。
     *
     * ## 为什么换掉是安全的
     *
     * · `ClampToEdge` 在边缘采样**重复边缘自身那一行/列**（不是对面的）⇒ 边缘内容连续
     *   ⇒ 那条线消失；
     * · 对 `[0,1]` **内部**的采样，两种模式**逐像素相同** ⇒ 不动任何正常画面；
     * · 对 tile 动画安全：`update()` 用 `offset` 移动取景窗，`offset = k/N`（整数倍）
     *   ⇒ UV 恒在 `[0,1]` 内、上边界恰好落在 `1.0`，clamp 取到的正是该格的边缘 texel。
     *   本项目现存工程的 `tilesHorizontal/Vertical/numTiles` 一律 1、`tileDisplayDuration` 为 0
     *   （tile 动画根本没启用），此改动实际只影响"边缘那一像素"。
     */
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1 / this.tilesHorizontal, 1 / this.tilesVertical);

    // how long has the current image been displayed?
    this.currentDisplayTime = 0;

    // which image is currently being displayed?
    this.currentTile = 0;
  }

  public update = (delta: number) => {
    /**
     * ★ 自转（2026-10-10）：`spinDegPerSec` 非 0 时绕贴图中心（z 轴）匀速转。
     *
     * 必须写在下面 `tileDisplayDuration === 0` 的提前返回**之前** ——
     * 本工程的贴图层全部 `tileDisplayDuration = 0`，写在后面会被直接跳过。
     *
     * `delta` 上游已钳在 0.1s（见 index.ts `render()` 的注释），故 WE 暂停恢复
     * 时不会因"整段暂停时长"而突跳一大段（最坏 0.4°，肉眼不可见）。
     * 取模 2π 只为避免长时间运行后 `rotation.z` 累积到丢精度。
     */
    if (this.spinDegPerSec !== 0) {
      const TWO_PI = Math.PI * 2;
      const step = ((this.spinDegPerSec * Math.PI) / 180) * delta;
      this.textureMesh.rotation.z =
        (this.textureMesh.rotation.z + step) % TWO_PI;
    }

    const milliSec = 1000 * delta;
    // if display time is zero for each tile, then no animation
    if (this.tileDisplayDuration === 0) {
      return;
    }

    this.currentDisplayTime += milliSec;
    while (this.currentDisplayTime > this.tileDisplayDuration) {
      this.currentDisplayTime -= this.tileDisplayDuration;
      this.currentTile++;
      if (this.currentTile === this.numberOfTiles) this.currentTile = 0;
      var currentColumn = this.currentTile % this.tilesHorizontal;
      this.texture.offset.x = currentColumn / this.tilesHorizontal;
      var currentRow = Math.floor(this.currentTile / this.tilesHorizontal);
      this.texture.offset.y = currentRow / this.tilesVertical;
    }
  };
}
