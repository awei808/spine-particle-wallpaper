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
import * as threejsSpine from 'threejs-spine-3.8-runtime-es6';
import { ActionAnimation, SpineMeshConfig } from '@src/config.type';
import { curosrMoveSlowDownFormula } from '@src/helper';
import * as Scene from '@src/initScene';

export class SpineAnimator {
  private skeletonMesh: threejsSpine.SkeletonMesh;
  private skeletonData: threejsSpine.SkeletonData;
  private cursorActionAnimationUpdateFunc: (
    resetBonePosition?: boolean
  ) => void;

  constructor(
    meshConfig: SpineMeshConfig,
    spineAssetManager: threejsSpine.AssetManager
  ) {
    const geometry = new THREE.BoxGeometry(100, 100, 100);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0,
      alphaTest: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      meshConfig?.position?.x ?? 0,
      meshConfig?.position?.y ?? 0,
      meshConfig?.position?.z ?? 0
    );
    /**
     * ★ 水平镜像（`config.meshes[].flipX`）：复刻 Unity UI 的 `localEulerAngles.y=180°`。
     * 给父节点设 `scale.x = -1` 即可绕**本 mesh 的原点**镜像 —— 与 Unity 绕节点 pivot
     * 转 180° 等价，且完全不碰骨架数据（改的是承载它的那个 Mesh）。
     * 在 `position.set` 之后设置：镜像轴就是 mesh 自己的 x，不改变它的落点。
     */
    if (meshConfig?.flipX) {
      mesh.scale.x = -1;
    }
    Scene.scene?.add(mesh);

    const atlas = spineAssetManager.get(meshConfig.atlasFileName);
    const atlasLoader = new threejsSpine.AtlasAttachmentLoader(atlas);
    let skeletonJsonOrBinary:
      | threejsSpine.SkeletonJson
      | threejsSpine.SkeletonBinary;
    if (meshConfig.jsonFileName) {
      skeletonJsonOrBinary = new threejsSpine.SkeletonJson(atlasLoader);
    } else if (meshConfig.skeletonFileName) {
      skeletonJsonOrBinary = new threejsSpine.SkeletonBinary(atlasLoader);
    } else {
      throw 'please provide a skeleton file';
    }

    skeletonJsonOrBinary.scale = meshConfig.scale ?? 1;
    const skeletonData = skeletonJsonOrBinary.readSkeletonData(
      spineAssetManager.get(
        meshConfig.jsonFileName ?? meshConfig.skeletonFileName
      )
    );
    this.skeletonData = skeletonData;

    // Create a SkeletonMesh from the data and attach it to the scene
    this.skeletonMesh = new threejsSpine.SkeletonMesh(
      skeletonData,
      (parameters) => {
        parameters.depthTest = true;
        parameters.depthWrite = false;
        /**
         * ★★★ 必须置 true，否则叠层顺序会被 three.js 改写（2026-10-17 定案）。
         *
         * three r149 `WebGLRenderer.renderObject()` 对
         * `transparent === true && side === DoubleSide && forceSinglePass === false`
         * 的材质会**把同一个 mesh 画两遍**（先 `side=BackSide`、再 `side=FrontSide`）。
         *
         * 而整个骨架被 `MeshBatcher` 合批进**同一个 geometry**，spine 的
         * 「按 drawOrder 叠层」语义完全依赖索引顺序 ⇒ 两遍拆分把它换成
         * 「**按三角形绕序分类**」：某槽位内**绕序与多数派相反**的少数派三角形
         * 会被排到另一遍，等于画到了本该压住它的上层之上。
         *
         * 实测后果（S8「星语心恋」`touch1`）：`R_arm2`（右前臂）12 颗三角形里
         * 有 1 颗屏幕有向面积为负（手臂旋转到某角度时过零翻转），它恰好压在
         * `L_arm2_2` 的轮廓边界上、采到 `R_arm2` 图集的暗带纹素 ⇒ 前臂闪出
         * 一道 4px×15px 深色细条（伸/收臂各一次）。置 true 后细缝逐像素消失，
         * 且全场景其余部分逐像素不变（无回归）。
         *
         * 依据：three r149 `Material.forceSinglePass` 默认 false（`Material.js:67`）；
         * customizer 收到的就是 `ShaderMaterialParameters`，会被 `super(parameters)` 消费
         * ⇒ 纯调用层改动，无需改 `threejs-spine-3.8-runtime-es6`。
         *
         * ⚠️ 不要改成 `side: FrontSide` 来绕过 —— 那会剔掉反绕序三角形，直接丢图元。
         *
         * 追查报告：`_work_星语心恋/_追查/REPORT_touch1肱二头肌深色三角.md` §9。
         */
        parameters.forceSinglePass = true;
      }
    );

    // set default animation on track 0
    this.skeletonMesh.state.setAnimation(0, meshConfig.animationName, true);

    // if the animation contains a cursor follow config, by default load the cursor follow animation
    this.cursorActionAnimationUpdateFunc =
      generateCursorActionAnimationUpdateFunc(
        this.skeletonMesh,
        meshConfig?.cursorFollow,
        skeletonData
      );

    document.addEventListener(
      'mousedown',
      (event: MouseEvent) => {
        event.preventDefault();
        // reset previous bone position
        this.cursorActionAnimationUpdateFunc &&
          this.cursorActionAnimationUpdateFunc(true);
        // assign a new bone control function
        this.cursorActionAnimationUpdateFunc =
          generateCursorActionAnimationUpdateFunc(
            this.skeletonMesh,
            meshConfig?.cursorPress,
            skeletonData
          );
      },
      false
    );
    document.addEventListener(
      'mouseup',
      (event: MouseEvent) => {
        event.preventDefault();
        // reset previous bone position
        this.cursorActionAnimationUpdateFunc &&
          this.cursorActionAnimationUpdateFunc(true);
        // assign a new bone control function
        this.cursorActionAnimationUpdateFunc =
          generateCursorActionAnimationUpdateFunc(
            this.skeletonMesh,
            meshConfig?.cursorFollow,
            skeletonData
          );
      },
      false
    );

    mesh.add(this.skeletonMesh); // skeletonMesh.parent === mesh
  }

  public update = (delta: number) => {
    //#region cursor follow/press calculate new bone position
    this.cursorActionAnimationUpdateFunc &&
      this.cursorActionAnimationUpdateFunc();
    //#endregion

    // the rest bone animation updates
    this.skeletonMesh.update(delta);
  };

  /** 供探针读取骨架里真实存在的动画名（不重复解析 .skel） */
  public getSkeletonData = (): threejsSpine.SkeletonData => {
    return this.skeletonData;
  };

  /**
   * **替换常驻动画**（track 0）—— 动作族换名用（2026-10-17）。
   *
   * 构造里已经按 `meshConfig.animationName` 设过一次（保证"没有动作族时逐字不变"）；
   * 这里只在"该骨架确实有换名后的动画"时覆盖一次。
   *
   * @returns 是否真的换了（`false` = 名字为空 / 骨架里没有 ⇒ 保持原常驻动画）
   *
   * ⚠️ 不做"不存在就静默" —— 返回 false 由调用方决定日志级别：
   *   挂件骨架没有 `_marry` 是**正常**的，角色骨架缺才是配置错误。
   * ⚠️ 不能直接 `state.setAnimation(0, name, true)`：未知名字会 **throw**
   *   （`AnimationState.ts:601-603`），所以先查 `findAnimation`。
   */
  public setIdleAnimation = (name: string): boolean => {
    if (!name) {
      return false;
    }
    const state = this.skeletonMesh?.state;
    if (!state?.data?.skeletonData?.findAnimation(name)) {
      return false;
    }
    state.setAnimation(0, name, true);
    return true;
  };

  /**
   * 供触摸控制器拿到 SkeletonMesh（需要它的 `state` 来播 track 2 动画）。
   *
   * 为什么不让 touch.ts 自己去解析/新建骨架：那样会加载第二份资源、状态也无法
   * 与渲染中的骨架同步。直接用现有实例才是唯一正确的做法。
   */
  public getSkeletonMesh = (): threejsSpine.SkeletonMesh => {
    return this.skeletonMesh;
  };

  /**
   * 供探针读取"当前各 track 在播什么"。
   *
   * 为什么需要：`cursorPress`/`cursorFollow` 机制在 mousedown 时用
   * `setAnimation(1, name, true)` —— 第三个参数 loop **写死为 true**。
   * 一旦 mouseup 时没切回去，track 1 会一直循环、永不回 idle。
   * 这类"卡住"问题在桌面上看不到 DevTools，只能读出来。
   *
   * 只读快照，不改变任何状态。API 依据：
   *   AnimationState.ts:806  getCurrent(i)  越界返回 null
   *   AnimationState.ts:841  TrackEntry.animation
   *   AnimationState.ts:867  TrackEntry.loop
   *   AnimationState.ts:926  TrackEntry.trackTime
   */
  public getTrackSnapshot = (): Array<{
    track: number;
    animation: string;
    loop: boolean;
    trackTime: number;
  }> => {
    const state = this.skeletonMesh?.state;
    if (!state || !state.tracks) {
      return [];
    }
    const out: Array<{
      track: number;
      animation: string;
      loop: boolean;
      trackTime: number;
    }> = [];
    for (let i = 0; i < state.tracks.length; i++) {
      const entry = state.getCurrent(i);
      /**
       * `getCurrent(i)` 在 `tracks[i]` 为 `null` 时返回 `null`（AnimationState.ts:806）。
       *
       * ★ 这里曾出过一个误导性读数：早期写成 `entry?.animation?.name ?? '(empty)'`，
       * 于是"track 已被正确清空（null）"被显示成 `'(empty)'`，
       * 让人误以为 `clearTrack` 没生效、有 `<empty>` 残留。
       * 实际 `(empty)` 这个名字专指 `AnimationState.emptyAnimation`
       * （`new Animation('<empty>', [], 0)`，AnimationState.ts:42），
       * 只可能由 `setEmptyAnimation` 产生。
       *
       * 现在：**空槽位直接跳过**，不清空则视为"该 track 无动画"，
       * 由调用方看到 rows 里没有该 track 号来判断。
       */
      if (!entry) {
        continue;
      }
      out.push({
        track: i,
        animation: entry.animation?.name ?? '(?)',
        loop: entry.loop ?? false,
        trackTime: entry.trackTime ?? 0,
      });
    }
    return out;
  };
}

/**
 * generate a function which is executed in each render round to follow the cursor
 *
 * @param skeletonMesh the Spine mesh
 * @param actionAnimationConfig cursor follow/press animation config
 * @param skeletonData this is used to get init bone position
 * @returns a callback function to be executed in each render
 */
const generateCursorActionAnimationUpdateFunc = (
  skeletonMesh: threejsSpine.SkeletonMesh,
  actionAnimationConfig: ActionAnimation,
  skeletonData: threejsSpine.SkeletonData
): ((resetBonePosition?: boolean) => void) => {
  const TRACK_NUM = 1;
  const cursorBone = actionAnimationConfig?.boneName
    ? skeletonMesh.skeleton.findBone(actionAnimationConfig?.boneName)
    : null;
  if (!actionAnimationConfig?.animationName || !cursorBone || !skeletonMesh) {
    return;
  }

  skeletonMesh?.state.setAnimation(
    TRACK_NUM,
    actionAnimationConfig?.animationName,
    true
  );

  const boneData = skeletonData.bones.find(
    (item) => item.name === actionAnimationConfig?.boneName
  );
  const initCursorActionBonePositionX = boneData?.x ?? 0;
  const initCursorActionBonePositionY = boneData?.y ?? 0;

  const actionBoneUpdateCallback = (resetBonePosition?: boolean) => {
    //#region cursor follow animation
    const mainMesh = skeletonMesh.parent;
    if (mainMesh && cursorBone) {
      const cursorPositionInDom = new THREE.Vector3(
        Scene.cursorX,
        Scene.cursorY,
        0
      );
      let cursoPositionInWorld = cursorPositionInDom.unproject(Scene.camera);
      cursoPositionInWorld = cursoPositionInWorld
        .sub(Scene.camera.position)
        .normalize();
      cursoPositionInWorld = cursoPositionInWorld.multiplyScalar(
        (mainMesh.position.z - Scene.camera.position.z) / cursoPositionInWorld.z
      );

      const cursoPositionInSpine = cursoPositionInWorld.sub(
        new THREE.Vector3(
          mainMesh.position.x,
          mainMesh.position.y,
          mainMesh.position.z
        )
      );

      // use .parent !!! => http://en.esotericsoftware.com/forum/How-to-move-bone-17029
      const cursoPositionInBone = cursorBone.parent.worldToLocal(
        new threejsSpine.Vector2(cursoPositionInSpine.x, cursoPositionInSpine.y)
      );
      // the bone and its parent may not be fully ready at the start
      if (!isNaN(cursoPositionInBone.x) && !isNaN(cursoPositionInBone.y)) {
        const cursorMove = new THREE.Vector2(
          cursoPositionInBone.x - initCursorActionBonePositionX,
          cursoPositionInBone.y - initCursorActionBonePositionY
        );
        const cursorMoveDirection = cursorMove.clone().normalize();
        const cursorMoveDistance = cursorMove.clone().length();
        const maxFollowDistance =
          actionAnimationConfig?.maxFollowDistance ?? 100;

        const distanceAfterSlowDown = curosrMoveSlowDownFormula(
          cursorMoveDistance,
          maxFollowDistance
        );

        if (resetBonePosition) {
          cursorBone.x = initCursorActionBonePositionX;
          cursorBone.y = initCursorActionBonePositionY;
        } else {
          cursorBone.x =
            initCursorActionBonePositionX +
            distanceAfterSlowDown * cursorMoveDirection.x;
          cursorBone.y =
            initCursorActionBonePositionY +
            distanceAfterSlowDown * cursorMoveDirection.y;
        }
      }
    }
    //#endregion
  };

  return actionBoneUpdateCallback;
};
