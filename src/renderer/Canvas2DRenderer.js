import IRenderer from './IRenderer.js';

/**
 * @class Canvas2DRenderer
 * @description 使用Canvas 2D API进行渲染的CPU渲染器。
 * 它继承自IRenderer，并实现了其所有核心方法。
 * 这种方式的特点是实现简单，但在实时交互时性能较低。
 * @extends IRenderer
 */
export default class Canvas2DRenderer extends IRenderer {
  /**
   * 构造函数
   * @param {HTMLElement} container - 渲染器将在其中创建Canvas的DOM容器元素。
   */
  constructor(container) {
    // 调用父类的构造函数
    super(container);

    // -- 私有成员变量 --
    /**
     * @private
     * @type {HTMLCanvasElement}
     * @description 用于绘制的Canvas DOM元素。
     */
    this.canvas = document.createElement('canvas');

    /**
     * @private
     * @type {CanvasRenderingContext2D}
     * @description Canvas 2D的绘图上下文。
     */
    this.ctx = this.canvas.getContext('2d');

    /**
     * @private
     * @description 渲染器内部持有的对当前DICOM数据的引用。
     * 这对于CPU渲染器在只更新视图状态时至关重要。
     */
    this.dicomData = null;

    // 将创建的canvas添加到容器中
    this.container.appendChild(this.canvas);

    // 初始化时调整一次尺寸
    this.resize();
  }

  /**
   * 核心渲染方法。
   * [修正] 现在可以处理只更新视图状态的情况。
   * @override
   * @param {object | null} dicomData - 若要加载新图像，则提供{dataSet, arrayBuffer}；若只更新视图，则为null。
   * @param {object} viewState - 包含 { windowCenter, windowWidth } 的对象。
   */
  render(dicomData, viewState) {
    // 如果传入了新的DICOM数据，就更新内部的引用
    if (dicomData?.dataSet) {
      this.dicomData = dicomData;
    }

    // 如果渲染器内部没有任何数据，则无法渲染
    if (!this.dicomData) {
      console.warn('Canvas2DRenderer 缺少必要的dicomData。');
      return;
    }

    // 使用内部持有的数据和传入的视图状态进行渲染
    const { dataSet, arrayBuffer } = this.dicomData;
    const { windowCenter, windowWidth } = viewState;

    // -- 1. 获取渲染所需的关键DICOM信息 --
    const rows = dataSet.uint16('x00280010');
    const columns = dataSet.uint16('x00280011');
    const rescaleSlope = dataSet.floatString('x00281053') || 1;
    const rescaleIntercept = dataSet.floatString('x00281052') || 0;

    // -- 2. 动态判断并获取像素数据 --
    const pixelDataElement = dataSet.elements.x7fe00010;
    const bitsAllocated = dataSet.uint16('x00280100');
    const pixelRepresentation = dataSet.uint16('x00280103');
    let pixelData;

    // (这部分逻辑与我们之前在demo中实现的一样)
    if (bitsAllocated === 16) {
      const pixelArray = pixelRepresentation === 1 ? Int16Array : Uint16Array;
      pixelData = new pixelArray(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
    } else if (bitsAllocated === 8) {
      const pixelArray = pixelRepresentation === 1 ? Int8Array : Uint8Array;
      pixelData = new pixelArray(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length);
    } else {
      throw new Error(`不支持的位深 (Bits Allocated): ${bitsAllocated}`);
    }

    // 调整canvas的内部（绘图表面）尺寸以匹配图像
    this.canvas.width = columns;
    this.canvas.height = rows;

    // -- 3. 准备Canvas的像素容器ImageData --
    const imageData = this.ctx.createImageData(columns, rows);

    // -- 4. 窗宽窗位核心算法，遍历并填充ImageData --
    const lowerBound = windowCenter - windowWidth / 2;
    const upperBound = windowCenter + windowWidth / 2;

    for (let i = 0; i < pixelData.length; i++) {
      // 应用斜率和截距，得到真实的HU值
      const huValue = pixelData[i] * rescaleSlope + rescaleIntercept;

      // 将HU值通过窗宽窗位映射到0-255的灰度值
      let grayValue = ((huValue - lowerBound) / (upperBound - lowerBound)) * 255;
      grayValue = Math.max(0, Math.min(255, grayValue)); // clamp

      // 将灰度值填充到ImageData中 (R, G, B, A)
      const index = i * 4;
      imageData.data[index] = grayValue; // R
      imageData.data[index + 1] = grayValue; // G
      imageData.data[index + 2] = grayValue; // B
      imageData.data[index + 3] = 255; // A (不透明)
    }

    // -- 5. 将处理好的像素数据一次性绘制到Canvas上 --
    this.ctx.putImageData(imageData, 0, 0);
  }

  /**
   * 响应式调整Canvas的显示尺寸。
   * 注意：这只改变Canvas元素本身在页面上的CSS尺寸，
   * 而不改变其内部绘图表面的分辨率（该分辨率在render方法中设置）。
   * @override
   */
  resize() {
    // 我们让canvas的CSS尺寸100%填充其父容器
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    // 同时保持其纵横比，以避免图像拉伸
    this.canvas.style.objectFit = 'contain';
  }

  /**
   * 销毁渲染器，释放资源。
   * 对于Canvas 2D渲染器，主要是从DOM中移除canvas并清空引用。
   * @override
   */
  dispose() {
    // 从容器中移除canvas元素
    if (this.canvas.parentElement) {
      this.container.removeChild(this.canvas);
    }
    // 清空引用，帮助垃圾回收
    this.ctx = null;
    this.canvas = null;
  }

  /**
   * [新增] 实现了setFPS接口。
   * 对于同步的CPU渲染器，此设置无效，因为其渲染频率由外部调用决定。
   * @override
   * @param {number} fps
   */
  setFPS(fps) {
    // 调用父类方法来更新属性，但不在内部使用它
    super.setFPS(fps);
    console.warn('Canvas2DRenderer不支持内部帧率控制，其渲染频率由调用方决定。');
  }
}
