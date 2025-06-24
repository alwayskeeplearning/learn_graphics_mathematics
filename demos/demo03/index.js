import dicomParser from 'dicom-parser';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import WebGLRenderer from '../../src/renderer/WebGLRenderer.js';
// Canvas2DRenderer暂时不用，先注释掉
// import Canvas2DRenderer from '../../src/renderer/Canvas2DRenderer.js';

// --- 1. 全局状态管理 ---
const AppState = {
  // 我们不再存储单个DICOM，而是存储整个序列的信息
  series: {
    slices: [], // 存储所有解析并排序后的切片对象
    isLoaded: false,
    width: 0,
    height: 0,
    depth: 0,
  },
  viewState: {
    windowCenter: 40,
    windowWidth: 400,
    sliceIndex: 0, // 新增：当前显示的切片索引
    // [新增] 体渲染参数
    alphaCorrection: 0.05,
    steps: 512,
    colorMode: true, // 新增：默认使用彩色模式
  },
  // [改造] UI相关的状态
  uiState: {
    tool: 'windowing', // 'windowing', 'scroll', 'volume'
    orbitControls: null, // [新增] 用于存储OrbitControls实例
  },
  /** @type {import('../../src/renderer/WebGLRenderer.js').default | null} */
  currentRenderer: null,
};

let uiUpdateRequested = false;
// [新增] 用于拖拽滚动的累加器
let scrollAccumulator = 0;
const SCROLL_THRESHOLD = 5; // 每拖拽5个像素滚动一帧

// --- 2. DOM 元素获取 ---
const loadBtn = document.getElementById('load-series-btn');
const canvasContainer = document.getElementById('canvas-container');
const statusText = document.getElementById('status-text');
const sliceInfoDiv = document.getElementById('slice-info');
const windowInfoDiv = document.getElementById('window-info');
const metadataDiv = document.getElementById('dicom-metadata');
const fpsInput = document.getElementById('fps-input');
// [改造] 工具按钮
const windowingBtn = document.getElementById('tool-windowing-btn');
const scrollBtn = document.getElementById('tool-scroll-btn');
const volumeBtn = document.getElementById('tool-volume-btn');

// [新增] 预设按钮
const presetBoneBtn = document.getElementById('preset-bone');
const presetSoftBtn = document.getElementById('preset-soft');
const presetLungBtn = document.getElementById('preset-lung');
const presetBrainBtn = document.getElementById('preset-brain');

// [新增] 滑动条控件
const windowCenterSlider = document.getElementById('window-center-slider');
const windowCenterValue = document.getElementById('window-center-value');
const windowWidthSlider = document.getElementById('window-width-slider');
const windowWidthValue = document.getElementById('window-width-value');
const alphaSlider = document.getElementById('alpha-slider');
const alphaValue = document.getElementById('alpha-value');
const stepsSlider = document.getElementById('steps-slider');
const stepsValue = document.getElementById('steps-value');

// --- 3. 核心功能函数 ---

/**
 * @description 生成要加载的DICOM文件URL列表
 * @returns {string[]}
 */
function generateFileUrls() {
  const urls = [];
  const baseName = 'CW023001-P001566398-CT20200727153936_';
  // 根据上一步查到的文件，总共有462个
  for (let i = 1; i <= 462; i++) {
    // 使用padStart确保数字是4位数，例如 1 -> "0001"
    const fileNumber = i.toString().padStart(4, '0');
    // 注意这里的路径，我们是从demos/demo03/index.js出发，所以是../../public/dicoms
    urls.push(`/static/dicoms/${baseName}${fileNumber}.dcm`);
  }
  return urls;
}

/**
 * @description [核心改造] 加载、解析并排序整个DICOM序列
 */
async function loadDicomSeries() {
  const urls = generateFileUrls();
  const totalFiles = urls.length;
  statusText.textContent = `开始加载 ${totalFiles} 个文件...`;
  loadBtn.disabled = true;

  try {
    const downloadPromises = urls.map(url =>
      fetch(url).then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for ${url}`);
        return res.arrayBuffer();
      }),
    );
    const arrayBuffers = await Promise.all(downloadPromises);
    statusText.textContent = `加载完成，开始解析...`;

    const slices = arrayBuffers.map((buffer, i) => {
      if (i % 20 === 0) {
        statusText.textContent = `解析中... ${((i / totalFiles) * 100).toFixed(0)}%`;
      }
      const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
      const imagePositionPatient = dataSet.string('x00200032').split('\\').map(parseFloat);
      return { dataSet, arrayBuffer: buffer, z: imagePositionPatient[2] };
    });

    statusText.textContent = `排序切片中...`;
    slices.sort((a, b) => a.z - b.z);

    const firstSlice = slices[0].dataSet;
    AppState.series = {
      slices,
      isLoaded: true,
      width: firstSlice.uint16('x00280011'),
      height: firstSlice.uint16('x00280010'),
      depth: slices.length,
    };
    // 更新 viewState
    AppState.viewState.windowCenter = firstSlice.floatString('x00281050', 0) || 40;
    AppState.viewState.windowWidth = firstSlice.floatString('x00281051', 0) || 400;
    AppState.viewState.sliceIndex = Math.floor(slices.length / 2);

    statusText.textContent = `创建3D纹理中...`;
    await new Promise(resolve => setTimeout(resolve, 0));

    // 先把 Volume 数据设置进去
    AppState.currentRenderer.setVolume(AppState.series);

    // --- [核心修复 1] ---
    // 然后用最新的 viewState 更新渲染器，确保初始窗宽窗位生效
    AppState.currentRenderer.setViewState(AppState.viewState);
    // --------------------

    // [新增] 同步UI控件的值
    updateUIControls();

    statusText.textContent = `序列加载完成！`;
    requestMetadataUpdate();
  } catch (error) {
    console.error('加载DICOM序列失败:', error);
    statusText.textContent = `错误: ${error.message}`;
    alert(`加载序列失败，请检查控制台获取更多信息。`);
  } finally {
    loadBtn.disabled = false;
  }
}

/**
 * @description 更新侧边栏的元数据信息显示
 */
function updateMetadata() {
  if (!AppState.series.isLoaded) {
    sliceInfoDiv.textContent = '切片: N/A';
    windowInfoDiv.textContent = '窗位: N/A | 窗宽: N/A';
    metadataDiv.textContent = '请先加载序列。';
    return;
  }
  const { width, height, depth } = AppState.series;
  const { windowCenter, windowWidth, sliceIndex } = AppState.viewState;

  sliceInfoDiv.textContent = `切片: ${sliceIndex + 1} / ${depth}`;
  windowInfoDiv.textContent = `窗位: ${windowCenter.toFixed(0)} | 窗宽: ${windowWidth.toFixed(0)}`;

  metadataDiv.innerHTML = `
    <strong>图像尺寸:</strong> ${width} x ${height}<br>
    <strong>切片总数:</strong> ${depth}<br>
    <strong>当前模式:</strong> ${AppState.uiState.tool === 'volume' ? '体渲染' : '2D切片'}<br>
    <strong>透明度:</strong> ${AppState.viewState.alphaCorrection}<br>
    <strong>采样次数:</strong> ${AppState.viewState.steps}
  `.trim();

  uiUpdateRequested = false;
}

function requestMetadataUpdate() {
  if (!uiUpdateRequested) {
    uiUpdateRequested = true;
    requestAnimationFrame(updateMetadata);
  }
}

// [改造] 更新工具按钮的激活状态
function updateToolButtons() {
  windowingBtn.classList.toggle('active-tool', AppState.uiState.tool === 'windowing');
  scrollBtn.classList.toggle('active-tool', AppState.uiState.tool === 'scroll');
  volumeBtn.classList.toggle('active-tool', AppState.uiState.tool === 'volume');
}

// [新增] 同步UI控件值
function updateUIControls() {
  const { windowCenter, windowWidth, alphaCorrection, steps } = AppState.viewState;

  windowCenterSlider.value = windowCenter;
  windowCenterValue.textContent = Math.round(windowCenter);
  windowWidthSlider.value = windowWidth;
  windowWidthValue.textContent = Math.round(windowWidth);
  alphaSlider.value = alphaCorrection;
  alphaValue.textContent = alphaCorrection.toFixed(2);
  stepsSlider.value = steps;
  stepsValue.textContent = steps;
}

// [新增] 应用预设窗口
function applyWindowPreset(center, width) {
  AppState.viewState.windowCenter = center;
  AppState.viewState.windowWidth = width;
  updateUIControls();
  if (AppState.currentRenderer) {
    AppState.currentRenderer.setViewState(AppState.viewState);
  }
  requestMetadataUpdate();
}

// [核心改造] 将模式切换逻辑提升到index.js
function setToolMode(tool) {
  // if (AppState.uiState.tool === tool) return; // 切换回2D时需要强制刷新
  AppState.uiState.tool = tool;

  const renderer = AppState.currentRenderer;
  const controls = AppState.uiState.orbitControls;

  if (!renderer || !controls) return;

  // --- [核心修复 2] ---
  if (tool === 'volume') {
    controls.enabled = true;
  } else {
    // 只要不是 'volume' 模式，就禁用 OrbitControls
    controls.enabled = false;
  }
  // --------------------

  // 直接通知渲染器
  renderer.setRenderMode(tool);
  // 把相机也更新一下，确保 controls 操作的是正确的相机
  controls.object = renderer.getCamera();
  controls.update();

  updateToolButtons();
  requestMetadataUpdate();
}

// --- 4. 事件监听与绑定 ---

function setupEventListeners() {
  loadBtn.addEventListener('click', loadDicomSeries);
  windowingBtn.addEventListener('click', () => setToolMode('windowing'));
  scrollBtn.addEventListener('click', () => setToolMode('scroll'));
  volumeBtn.addEventListener('click', () => setToolMode('volume'));

  // [新增] 预设按钮事件
  presetBoneBtn.addEventListener('click', () => applyWindowPreset(500, 1000));
  presetSoftBtn.addEventListener('click', () => applyWindowPreset(40, 400));
  presetLungBtn.addEventListener('click', () => applyWindowPreset(-600, 1500));
  presetBrainBtn.addEventListener('click', () => applyWindowPreset(40, 80));

  // [新增] 滑动条事件
  windowCenterSlider.addEventListener('input', e => {
    AppState.viewState.windowCenter = parseFloat(e.target.value);
    windowCenterValue.textContent = Math.round(AppState.viewState.windowCenter);
    if (AppState.currentRenderer) {
      AppState.currentRenderer.setViewState(AppState.viewState);
    }
    requestMetadataUpdate();
  });

  windowWidthSlider.addEventListener('input', e => {
    AppState.viewState.windowWidth = parseFloat(e.target.value);
    windowWidthValue.textContent = Math.round(AppState.viewState.windowWidth);
    if (AppState.currentRenderer) {
      AppState.currentRenderer.setViewState(AppState.viewState);
    }
    requestMetadataUpdate();
  });

  alphaSlider.addEventListener('input', e => {
    AppState.viewState.alphaCorrection = parseFloat(e.target.value);
    alphaValue.textContent = AppState.viewState.alphaCorrection.toFixed(2);
    if (AppState.currentRenderer) {
      AppState.currentRenderer.setViewState(AppState.viewState);
    }
    requestMetadataUpdate();
  });

  stepsSlider.addEventListener('input', e => {
    AppState.viewState.steps = parseInt(e.target.value);
    stepsValue.textContent = AppState.viewState.steps;
    if (AppState.currentRenderer) {
      AppState.currentRenderer.setViewState(AppState.viewState);
    }
    requestMetadataUpdate();
  });

  canvasContainer.addEventListener('wheel', event => {
    if (AppState.uiState.tool === 'volume' || !AppState.series.isLoaded) return;
    event.preventDefault();

    AppState.viewState.sliceIndex += event.deltaY > 0 ? 1 : -1;
    const { depth } = AppState.series;
    AppState.viewState.sliceIndex = Math.max(0, Math.min(AppState.viewState.sliceIndex, depth - 1));

    AppState.currentRenderer.setViewState(AppState.viewState);
    requestMetadataUpdate();
  });

  let isMouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  canvasContainer.addEventListener('mousedown', e => {
    if (AppState.uiState.tool === 'volume') return;
    isMouseDown = true;
    lastMouseX = e.pageX;
    lastMouseY = e.pageY;
    scrollAccumulator = 0;
  });
  canvasContainer.addEventListener('mouseup', () => {
    isMouseDown = false;
  });
  canvasContainer.addEventListener('mouseleave', () => {
    isMouseDown = false;
  });
  canvasContainer.addEventListener('mousemove', e => {
    if (!isMouseDown || !AppState.series.isLoaded) return;

    const deltaX = e.pageX - lastMouseX;
    const deltaY = e.pageY - lastMouseY;
    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    if (AppState.uiState.tool === 'windowing') {
      AppState.viewState.windowCenter += deltaX;
      AppState.viewState.windowWidth += deltaY;
      if (AppState.viewState.windowWidth < 1) AppState.viewState.windowWidth = 1;

      // [新增] 同步滑动条
      updateUIControls();
    } else if (AppState.uiState.tool === 'scroll') {
      scrollAccumulator += deltaY;
      if (Math.abs(scrollAccumulator) >= SCROLL_THRESHOLD) {
        const sliceChange = Math.floor(scrollAccumulator / SCROLL_THRESHOLD);
        AppState.viewState.sliceIndex -= sliceChange;
        scrollAccumulator %= SCROLL_THRESHOLD;
        const { depth } = AppState.series;
        AppState.viewState.sliceIndex = Math.max(0, Math.min(AppState.viewState.sliceIndex, depth - 1));
      }
    }

    AppState.currentRenderer.setViewState(AppState.viewState);
    requestMetadataUpdate();
  });

  // [新增] 颜色模式切换事件
  document.querySelectorAll('input[name="color-mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      AppState.viewState.colorMode = e.target.value === 'color';
      if (AppState.currentRenderer) {
        AppState.currentRenderer.setViewState(AppState.viewState);
      }
      requestMetadataUpdate();
    });
  });
}

fpsInput.addEventListener('change', event => {
  const fps = parseInt(event.target.value, 10);
  if (AppState.currentRenderer) {
    AppState.currentRenderer.setFPS(fps);
  }
});

window.addEventListener('resize', () => {
  if (AppState.currentRenderer) {
    AppState.currentRenderer.resize();
  }
});

/**
 * @description 应用初始化
 */
function main() {
  const renderer = new WebGLRenderer(canvasContainer);
  AppState.currentRenderer = renderer;

  const controls = new OrbitControls(renderer.getCamera(), renderer.getDomElement());

  // [核心修复] 解除旋转限制，实现自由旋转
  controls.enableDamping = false; // 启用阻尼让旋转更流畅
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = false;

  // [关键] 解除垂直旋转角度限制，允许360度全方位旋转
  controls.minPolarAngle = 0; // 垂直旋转最小角度 (默认是0)
  controls.maxPolarAngle = Math.PI; // 垂直旋转最大角度 (默认约2.2，这里改为Math.PI允许完整旋转)

  // [关键] 解除水平旋转限制，允许无限旋转
  controls.minAzimuthAngle = -Infinity; // 水平旋转最小角度
  controls.maxAzimuthAngle = Infinity; // 水平旋转最大角度

  // [关键] 解除缩放限制，提供更大的缩放范围
  controls.minDistance = 0.1; // 最小缩放距离
  controls.maxDistance = 50; // 最大缩放距离

  AppState.uiState.orbitControls = controls;

  // 渲染循环只负责更新controls
  function animate() {
    requestAnimationFrame(animate);
    if (controls.enabled) {
      controls.update();
    }
  }

  // 绑定所有事件
  setupEventListeners();

  // 将渲染绑定到controls的change事件，实现按需渲染
  controls.addEventListener('change', renderer.render);

  // 启动动画循环
  animate();

  // [关键修复] 所有东西都初始化完毕后，最后再设置初始模式
  setToolMode('windowing');

  requestMetadataUpdate();
}

// --- 5. 应用启动 ---
try {
  main();
} catch (error) {
  console.error('应用初始化失败:', error);
  alert(`应用初始化失败: ${error.message}。请检查控制台。`);
}
