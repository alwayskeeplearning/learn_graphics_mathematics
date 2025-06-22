/**
 * @class IRenderer
 * @description 这是一个渲染器的接口定义（通过基类模拟）。
 * 所有具体的渲染器都应继承自该类，并实现其定义的方法。
 * 它约定了渲染器与上层应用之间的"合同"。
 */
export default class IRenderer {
  /**
   * 构造函数
   * @param {HTMLElement} container - 渲染器将在其中创建Canvas的DOM容器元素。
   */
  constructor(container) {
    if (!container) {
      throw new Error('渲染器必须提供一个容器元素。');
    }
    this.container = container;

    /**
     * @description 目标帧率 (Frames Per Second)。
     * @type {number}
     */
    this.fps = 60; // 默认给一个较高的值
    /**
     * @description 根据fps计算出的、每帧之间的最小时间间隔（毫秒）。
     * @type {number}
     */
    this.interval = 1000 / this.fps;
    /**
     * @description 上一次成功渲染的时间戳。
     * @type {number}
     */
    this.lastRenderTime = 0;
  }

  /**
   * [新增] 设置渲染器的目标帧率。
   * @param {number} fps - 每秒的帧数。
   */
  setFPS(fps) {
    if (fps <= 0) {
      // 允许设置为0或负数，意味着"无限制"，即按rAF的最大速率渲染
      this.fps = 0;
      this.interval = 0;
    } else {
      this.fps = fps;
      this.interval = 1000 / fps;
    }
  }

  /**
   * 核心渲染方法。
   * 该方法应被具体渲染器重写。
   * @param {object} dicomData - 包含渲染所需DICOM数据的对象。
   * 通常应包括 { dataSet, arrayBuffer }。
   * @param {object} viewState - 包含视图状态的对象。
   * 通常应包括 { windowCenter, windowWidth }。
   */
  // eslint-disable-next-line no-unused-vars
  render(dicomData, viewState) {
    // 基类中的方法可以抛出错误，强制子类必须实现它。
    throw new Error('该方法必须在子类中被重写。');
  }

  /**
   * 当容器尺寸变化时，调用此方法来响应式地调整渲染区域的大小。
   * 该方法应被具体渲染器重写。
   */
  resize() {
    throw new Error('该方法必须在子类中被重写。');
  }

  /**
   * 销毁渲染器实例。
   * 负责释放所有占用的资源，如WebGL上下文、事件监听器、DOM元素等，防止内存泄漏。
   * 该方法应被具体渲染器重写。
   */
  dispose() {
    throw new Error('该方法必须在子类中被重写。');
  }
}
