import * as THREE from 'three';
import IRenderer from './IRenderer.js';

/**
 * @class WebGLRenderer
 * @description 使用"按需渲染"策略的高性能GPU渲染器。
 * 只有在数据或视图状态变化时，才会请求一次渲染，从而在静态时实现零资源消耗。
 * @extends IRenderer
 */
export default class WebGLRenderer extends IRenderer {
  /**
   * 构造函数
   * @param {HTMLElement} container - 渲染器将在其中创建Canvas的DOM容器元素。
   */
  constructor(container) {
    super(container);

    // -- Three.js 核心对象 --
    /** @private */ this.scene = new THREE.Scene();
    /** @private */ this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1);
    /** @private */ this.renderer = new THREE.WebGLRenderer();

    // -- 状态与资源管理 --
    /** @private */ this.mesh = null; // 用于显示图像的平面网格
    /** @private */ this.material = null; // 应用于网格的自定义着色器材质
    /** @private */ this.texture = null; // 存储DICOM像素数据的GPU纹理

    // -- 按需渲染的状态标志 --
    /**
     * @private
     * @description "脏"标记。当场景内容需要重绘时为true。
     */
    this.isDirty = true;
    /**
     * @private
     * @description 渲染请求标记。防止在同一帧内重复请求渲染。
     */
    this.renderRequested = false;

    this.init();
  }

  /**
   * @private
   * 初始化设置
   */
  init() {
    this.camera.position.z = 1;
    this.container.appendChild(this.renderer.domElement);
    this.resize(); // 初始化时调整尺寸并触发第一次渲染
  }

  /**
   * [核心改造]
   * 该方法现在是上层应用与渲染器交互的主要入口。
   * 它负责更新数据，并将场景标记为"脏"，然后请求一次渲染。
   * @override
   * @param {object | null} dicomData - 若要加载新图像，则提供{dataSet, arrayBuffer}；若只更新视图，则为null。
   * @param {object} viewState - 包含{windowCenter, windowWidth}的对象。
   */
  render(dicomData, viewState) {
    // 如果传入了新的DICOM数据，则需要全量更新GPU资源
    if (dicomData?.dataSet) {
      this._updateGPUResources(dicomData, viewState);
    }

    // 无论如何，都根据最新的viewState更新uniforms
    if (this.material) {
      this.material.uniforms.u_windowCenter.value = viewState.windowCenter;
      this.material.uniforms.u_windowWidth.value = viewState.windowWidth;
    }

    // 将场景标记为"脏"，并请求在下一帧进行渲染
    this._invalidate();
  }

  /**
   * [核心改造]
   * @private
   * 负责处理加载新图像时的GPU资源创建与更新。
   * @param {object} dicomData
   * @param {object} viewState
   */
  // eslint-disable-next-line no-unused-vars
  _updateGPUResources(dicomData, viewState) {
    const { dataSet, arrayBuffer } = dicomData;
    const rows = dataSet.uint16('x00280010');
    const columns = dataSet.uint16('x00280011');
    const rescaleSlope = dataSet.floatString('x00281053') || 1;
    const rescaleIntercept = dataSet.floatString('x00281052') || 0;

    // --- [核心修正] 判断数据符号类型，并更新材质定义 ---
    const pixelRepresentation = dataSet.uint16('x00280103');
    const isSigned = pixelRepresentation === 1;

    if (!this.material) {
      this.material = this._createMaterial();
    }
    // 更新材质的defines，这会告诉Three.js在下次使用前需要重新编译shader
    if (this.material.defines.IS_SIGNED !== isSigned) {
      this.material.defines.IS_SIGNED = isSigned;
      this.material.needsUpdate = true; // 关键！强制重新编译着色器
    }

    // ... (更新uniforms) ...
    this.material.uniforms.u_rescaleSlope.value = rescaleSlope;
    this.material.uniforms.u_rescaleIntercept.value = rescaleIntercept;

    // --- 纹理销毁并重建 ---
    if (this.texture) this.texture.dispose();
    const bitsAllocated = dataSet.uint16('x00280100');
    // (这里的逻辑现在只关注位深，因为符号由上面的isSigned决定)
    let pixelData, textureType;
    if (bitsAllocated === 16) {
      textureType = isSigned ? THREE.ShortType : THREE.UnsignedShortType;
      pixelData = new (isSigned ? Int16Array : Uint16Array)(arrayBuffer, dataSet.elements.x7fe00010.dataOffset, dataSet.elements.x7fe00010.length / 2);
    } else if (bitsAllocated === 8) {
      textureType = isSigned ? THREE.ByteType : THREE.UnsignedByteType;
      pixelData = new (isSigned ? Int8Array : Uint8Array)(arrayBuffer, dataSet.elements.x7fe00010.dataOffset, dataSet.elements.x7fe00010.length);
    } else {
      throw new Error(`不支持的位深 (Bits Allocated): ${bitsAllocated}`);
    }
    this.texture = new THREE.DataTexture(pixelData, columns, rows, THREE.RedIntegerFormat, textureType);
    this.texture.needsUpdate = true;
    this.material.uniforms.u_texture.value = this.texture;

    // 网格和几何体复用/创建
    if (!this.mesh) {
      const geometry = new THREE.PlaneGeometry(columns, rows);
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.scene.add(this.mesh);
    } else {
      const oldGeometry = this.mesh.geometry;
      if (oldGeometry.parameters.width !== columns || oldGeometry.parameters.height !== rows) {
        oldGeometry.dispose();
        this.mesh.geometry = new THREE.PlaneGeometry(columns, rows);
      }
    }

    this.updateCamera(columns, rows);
  }

  /**
   * @private
   * 将场景标记为"脏"，并请求一次渲染。
   */
  _invalidate() {
    this.isDirty = true;
    this._requestRender();
  }

  /**
   * @private
   * 使用requestAnimationFrame节流渲染请求。
   * 确保在一帧内，即使有多次状态更新，也只执行一次渲染。
   */
  _requestRender() {
    if (!this.renderRequested) {
      this.renderRequested = true;
      requestAnimationFrame(() => this._performRender());
    }
  }

  /**
   * @private
   * 真正执行渲染操作的地方。
   * [核心改造] 加入了基于时间的帧率控制守卫。
   */
  _performRender() {
    this.renderRequested = false; // 允许下一帧的渲染请求

    // --- [新增] 帧率控制逻辑 ---
    const now = performance.now();
    const elapsed = now - this.lastRenderTime;

    // 只有当场景是"脏"的，并且距离上次渲染的时间间隔已足够长，才执行绘制
    if (this.isDirty && elapsed >= this.interval) {
      this.lastRenderTime = now - (elapsed % this.interval); // 校准时间，防止长时间卡顿后连续渲染

      this.renderer.render(this.scene, this.camera);
      this.isDirty = false;
    }

    // 如果因为时间未到而跳过了本次渲染，但场景仍然是"脏"的，
    // 我们需要再次请求下一帧，以确保它最终会被画出来。
    if (this.isDirty) {
      this._requestRender();
    }
  }

  /**
   * @private
   * 创建ShaderMaterial的辅助函数
   */
  _createMaterial() {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      // --- [核心修正] 初始化defines ---
      defines: {
        IS_SIGNED: true, // 默认是有符号，后续会动态更新
      },
      uniforms: {
        u_texture: { value: null },
        u_windowCenter: { value: 0.0 },
        u_windowWidth: { value: 0.0 },
        u_rescaleSlope: { value: 1.0 },
        u_rescaleIntercept: { value: 0.0 },
      },
      vertexShader: `
        out vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        
        // --- [核心修正] 使用条件编译选择采样器类型 ---
        #ifdef IS_SIGNED
          precision highp isampler2D;
          uniform isampler2D u_texture;
        #else
          precision highp usampler2D;
          uniform usampler2D u_texture;
        #endif

        in vec2 vUv;
        out vec4 out_FragColor;

        uniform float u_windowCenter;
        uniform float u_windowWidth;
        uniform float u_rescaleSlope;
        uniform float u_rescaleIntercept;

        void main() {
          // --- 核心修正 ---
          // 我们翻转传入的vUv.y坐标，以匹配WebGL的纹理坐标系
          vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
          
          // 使用翻转后的UV坐标进行纹理采样
          float storedValue = float(texture(u_texture, flippedUv).r);
          
          // (后续的窗宽窗位计算逻辑完全不变)
          float huValue = storedValue * u_rescaleSlope + u_rescaleIntercept;
          float lowerBound = u_windowCenter - u_windowWidth / 2.0;
          float upperBound = u_windowCenter + u_windowWidth / 2.0;
          float grayValue = (huValue - lowerBound) / (upperBound - lowerBound);
          grayValue = clamp(grayValue, 0.0, 1.0);
          out_FragColor = vec4(grayValue, grayValue, grayValue, 1.0);
        }
      `,
    });
  }

  /**
   * 响应式调整渲染区域和相机，并触发一次渲染。
   * @override
   */
  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);

    if (this.mesh) {
      this.updateCamera(this.mesh.geometry.parameters.width, this.mesh.geometry.parameters.height);
    }
    // 窗口尺寸变化也需要重绘
    this._invalidate();
  }

  /**
   * 销毁渲染器，彻底释放所有GPU资源和DOM元素。
   * @override
   */
  dispose() {
    // 对于按需渲染，不需要cancelAnimationFrame，因为它不会持续循环

    // 释放Three.js资源
    this.scene.remove(this.mesh);
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.texture?.dispose();
    this.renderer.dispose();

    // 从DOM中移除canvas
    this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);

    // 清空引用
    this.scene = null;
    this.camera = null;
    this.renderer = null;
  }

  /**
   * @private
   * 根据图像尺寸和容器尺寸，更新正交相机，确保图像显示不拉伸且居中。
   * 这个方法是实现响应式布局(Responsive Layout)的核心。
   * @param {number} imageWidth - DICOM图像的宽度（列数）。
   * @param {number} imageHeight - DICOM图像的高度（行数）。
   */
  updateCamera(imageWidth, imageHeight) {
    // 1. 计算容器和图像的宽高比

    /**
     * @description 容器的宽高比 (e.g., 16:9 -> 1.77)
     */
    const aspect = this.container.clientWidth / this.container.clientHeight;

    /**
     * @description 图像本身的宽高比 (e.g., 512x512 -> 1.0)
     */
    const imageAspect = imageWidth / imageHeight;

    // 2. 决定相机的"视野"尺寸

    // 这两个变量将定义相机在世界坐标系中能看到的宽度和高度。
    let cameraViewWidth, cameraViewHeight;

    // 3. 核心判断：以哪个边为基准进行适配

    // 情况A: 容器比图像更"宽" (例如，在一个16:9的屏幕上看一张1:1的方形图片)
    if (aspect > imageAspect) {
      // 策略: 让图像的高度填满容器的高度，然后根据容器的宽高比计算视野宽度。
      // 这样能确保图像在垂直方向上撑满，而在水平方向上按比例缩放，从而在左右留下黑边。
      cameraViewHeight = imageHeight;
      cameraViewWidth = cameraViewHeight * aspect;
    }
    // 情况B: 容器比图像更"高"或一样宽 (例如，在一个手机竖屏上看一张16:9的电影截图)
    else {
      // 策略: 让图像的宽度填满容器的宽度，然后根据容器的宽高比计算视野高度。
      // 这样能确保图像在水平方向上撑满，而在垂直方向上按比例缩放，从而在上下留下黑边。
      cameraViewWidth = imageWidth;
      cameraViewHeight = cameraViewWidth / aspect;
    }

    // 4. 设置相机的视景体(Frustum)

    // 正交相机的视景体是一个长方体。
    // 我们需要定义它在x轴（左/右）和y轴（上/下）的范围。
    // 除以2是因为相机位于原点(0,0)，我们需要向两侧对称地扩展。
    this.camera.left = -cameraViewWidth / 2;
    this.camera.right = cameraViewWidth / 2;
    this.camera.top = cameraViewHeight / 2;
    this.camera.bottom = -cameraViewHeight / 2;

    // 5. 应用更改

    // 在修改了相机的任何属性后，必须调用此方法来使更改生效。
    this.camera.updateProjectionMatrix();
  }
}
