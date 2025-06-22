import dicomParser from 'dicom-parser';
import WebGLRenderer from '../../src/renderer/WebGLRenderer.js';
import Canvas2DRenderer from '../../src/renderer/Canvas2DRenderer.js';

// --- 1. 全局状态管理 ---

/**
 * @description 应用的核心数据状态
 */
const AppState = {
  dicomData: {
    dataSet: null,
    arrayBuffer: null,
    isLoaded: false,
  },
  viewState: {
    windowCenter: 40,
    windowWidth: 400,
  },
  /** @type {import('../../src/renderer/IRenderer.js').default | null} */
  currentRenderer: null,
};

/**
 * @description UI更新节流标记。防止在高频事件中过度操作DOM。
 */
let uiUpdateRequested = false;

// --- 2. DOM 元素获取 ---
const fileInput = document.getElementById('file-input');
const canvasContainer = document.getElementById('canvas-container');
const metadataDiv = document.getElementById('dicom-metadata');
const rendererSwitches = document.querySelectorAll('input[name="renderer-type"]');
const fpsInput = document.getElementById('fps-input');

// --- 3. 核心功能函数 ---

/**
 * @description 根据用户选择的类型，销毁旧渲染器并创建新渲染器
 * @param {('webgl'|'canvas2d')} type
 */
function switchRenderer(type) {
  // 如果存在旧渲染器，先调用其dispose方法进行清理
  if (AppState.currentRenderer) {
    AppState.currentRenderer.dispose();
  }

  // 根据类型创建新的渲染器实例
  if (type === 'webgl') {
    AppState.currentRenderer = new WebGLRenderer(canvasContainer);
    console.log('已切换到 WebGL 渲染器');
  } else {
    AppState.currentRenderer = new Canvas2DRenderer(canvasContainer);
    console.log('已切换到 Canvas 2D 渲染器');
  }

  // 如果已经有加载好的DICOM数据，立即用新渲染器渲染一次
  if (AppState.dicomData.isLoaded) {
    AppState.currentRenderer.render(AppState.dicomData, AppState.viewState);
    requestMetadataUpdate();
  }
}

/**
 * @description 更新侧边栏的元数据信息显示
 */
function updateMetadata() {
  if (!AppState.dicomData.isLoaded) {
    metadataDiv.textContent = '请先加载一个DICOM文件。';
    return;
  }
  const ds = AppState.dicomData.dataSet;
  const patientName = ds.string('x00100010') || 'N/A';
  const rows = ds.uint16('x00280010');
  const columns = ds.uint16('x00280011');

  metadataDiv.innerHTML = `
    <strong>患者姓名:</strong> ${patientName}<br>
    <strong>图像尺寸:</strong> ${columns} x ${rows}<br>
    <strong>窗位 (WC):</strong> ${AppState.viewState.windowCenter.toFixed(2)}<br>
    <strong>窗宽 (WW):</strong> ${AppState.viewState.windowWidth.toFixed(2)}
  `.trim();

  // 更新完成后，重置请求标志
  uiUpdateRequested = false;
}

/**
 * @description [新增] 请求一次元数据UI更新。
 * 使用requestAnimationFrame来节流，确保每帧最多只更新一次DOM。
 */
function requestMetadataUpdate() {
  if (!uiUpdateRequested) {
    uiUpdateRequested = true;
    requestAnimationFrame(updateMetadata);
  }
}

// --- 4. 事件监听与绑定 ---

// 监听文件选择
fileInput.addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const arrayBuffer = e.target.result;
    try {
      const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
      // 更新DICOM数据状态
      AppState.dicomData = { dataSet, arrayBuffer, isLoaded: true };
      // 从文件初始化窗宽窗位
      AppState.viewState.windowCenter = dataSet.floatString('x00281050', 0) || 40;
      AppState.viewState.windowWidth = dataSet.floatString('x00281051', 0) || 400;

      // 使用当前渲染器进行渲染
      AppState.currentRenderer.render(AppState.dicomData, AppState.viewState);
      requestMetadataUpdate();
    } catch (error) {
      console.error('DICOM 文件解析失败:', error);
      alert('无法解析此DICOM文件。');
    }
  };
  reader.readAsArrayBuffer(file);
});

// 监听渲染器切换
rendererSwitches.forEach(radio => {
  radio.addEventListener('change', event => {
    switchRenderer(event.target.value);
  });
});

// 监听鼠标交互以调整窗宽窗位
let lastMouseX = 0;
let lastMouseY = 0;
let isMouseDown = false;

canvasContainer.addEventListener('mousedown', e => {
  isMouseDown = true;
  lastMouseX = e.pageX;
  lastMouseY = e.pageY;
});

canvasContainer.addEventListener('mouseup', () => {
  isMouseDown = false;
});
canvasContainer.addEventListener('mouseleave', () => {
  isMouseDown = false;
});

canvasContainer.addEventListener('mousemove', e => {
  if (isMouseDown) {
    const deltaX = e.pageX - lastMouseX;
    const deltaY = e.pageY - lastMouseY;
    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    // 更新视图状态
    AppState.viewState.windowCenter += deltaX * 1; // 灵敏度可调
    AppState.viewState.windowWidth += deltaY * 1;
    if (AppState.viewState.windowWidth < 1) AppState.viewState.windowWidth = 1;

    // 使用当前渲染器进行重绘
    AppState.currentRenderer.render(null, AppState.viewState);

    // 请求UI更新，而不是直接调用
    requestMetadataUpdate();
  }
});

// [新增] 监听FPS输入变化
fpsInput.addEventListener('change', event => {
  const fps = parseInt(event.target.value, 10);
  if (AppState.currentRenderer) {
    AppState.currentRenderer.setFPS(fps);
  }
});

// 监听窗口大小变化
window.addEventListener('resize', () => {
  if (AppState.currentRenderer) {
    AppState.currentRenderer.resize();
  }
});

// --- 5. 应用启动 ---
function main() {
  // 默认启动WebGL渲染器
  switchRenderer('webgl');
  // [新增] 初始化时，为默认的渲染器设置初始FPS
  if (AppState.currentRenderer) {
    AppState.currentRenderer.setFPS(parseInt(fpsInput.value, 10));
  }
}

main();
