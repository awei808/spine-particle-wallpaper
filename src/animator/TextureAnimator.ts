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

    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
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
