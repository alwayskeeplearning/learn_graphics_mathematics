import dicomParser from 'dicom-parser';
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
  },
  // [新增] UI相关的状态
  uiState: {
    tool: 'windowing', // 'windowing' 或 'scroll'
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
const metadataDiv = document.getElementById('dicom-metadata');
const fpsInput = document.getElementById('fps-input');
// [新增] 工具按钮
const windowingBtn = document.getElementById('tool-windowing-btn');
const scrollBtn = document.getElementById('tool-scroll-btn');

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
    // 注意这里的路径，我们是从demos/demo02/index.js出发，所以是../../dicoms
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
    // 1. 并行下载所有文件
    const downloadPromises = urls.map(url => fetch(url).then(res => res.arrayBuffer()));
    const arrayBuffers = await Promise.all(downloadPromises);
    statusText.textContent = `加载完成，开始解析...`;

    // 2. 解析每一个文件，并提取所需信息
    const slices = arrayBuffers.map((buffer, i) => {
      // 更新加载进度
      if (i % 20 === 0) {
        const percent = ((i / totalFiles) * 100).toFixed(0);
        statusText.textContent = `解析中... ${percent}%`;
      }
      const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
      // 获取用于排序的Z轴坐标
      const imagePositionPatient = dataSet.string('x00200032').split('\\').map(parseFloat);
      return {
        dataSet,
        arrayBuffer: buffer,
        z: imagePositionPatient[2], // Z坐标
      };
    });

    // 3. 按Z轴坐标进行排序
    statusText.textContent = `排序切片中...`;
    slices.sort((a, b) => a.z - b.z);

    // 4. 更新全局状态
    const firstSlice = slices[0].dataSet;
    AppState.series = {
      slices,
      isLoaded: true,
      width: firstSlice.uint16('x00280011'),
      height: firstSlice.uint16('x00280010'),
      depth: slices.length,
    };
    // 从第一张图初始化窗宽窗位
    AppState.viewState.windowCenter = firstSlice.floatString('x00281050', 0) || 40;
    AppState.viewState.windowWidth = firstSlice.floatString('x00281051', 0) || 400;
    AppState.viewState.sliceIndex = Math.floor(slices.length / 2); // 默认显示中间一张

    // 5. 将数据传递给渲染器
    statusText.textContent = `创建3D纹理中... (这可能需要几秒钟)`;
    await new Promise(resolve => setTimeout(resolve, 0)); // 给浏览器一点时间重绘UI
    AppState.currentRenderer.setVolume(AppState.series);
    AppState.currentRenderer.render(AppState.viewState);

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
    metadataDiv.textContent = '请先加载序列。';
    return;
  }
  const { width, height, depth } = AppState.series;
  const { windowCenter, windowWidth, sliceIndex } = AppState.viewState;

  sliceInfoDiv.textContent = `切片: ${sliceIndex + 1} / ${depth}`;

  metadataDiv.innerHTML = `
    <strong>图像尺寸:</strong> ${width} x ${height}<br>
    <strong>切片总数:</strong> ${depth}<br>
    <strong>窗位 (WC):</strong> ${windowCenter.toFixed(2)}<br>
    <strong>窗宽 (WW):</strong> ${windowWidth.toFixed(2)}
  `.trim();

  uiUpdateRequested = false;
}

function requestMetadataUpdate() {
  if (!uiUpdateRequested) {
    uiUpdateRequested = true;
    requestAnimationFrame(updateMetadata);
  }
}

// [新增] 更新工具按钮的激活状态
function updateToolButtons() {
  if (AppState.uiState.tool === 'windowing') {
    windowingBtn.classList.add('active-tool');
    scrollBtn.classList.remove('active-tool');
  } else {
    windowingBtn.classList.remove('active-tool');
    scrollBtn.classList.add('active-tool');
  }
}

// --- 4. 事件监听与绑定 ---

// 监听加载按钮
loadBtn.addEventListener('click', loadDicomSeries);

// [新增] 监听工具按钮点击
windowingBtn.addEventListener('click', () => {
  AppState.uiState.tool = 'windowing';
  updateToolButtons();
});

scrollBtn.addEventListener('click', () => {
  AppState.uiState.tool = 'scroll';
  updateToolButtons();
});

// [核心改造] 监听鼠标滚轮以切换切片
canvasContainer.addEventListener('wheel', event => {
  event.preventDefault(); // 防止页面滚动
  if (!AppState.series.isLoaded) return;

  // 根据滚轮方向更新切片索引
  if (event.deltaY > 0) {
    AppState.viewState.sliceIndex++;
  } else {
    AppState.viewState.sliceIndex--;
  }

  // 保证索引在合法范围内
  const depth = AppState.series.depth;
  AppState.viewState.sliceIndex = Math.max(0, Math.min(AppState.viewState.sliceIndex, depth - 1));

  // 触发重绘
  AppState.currentRenderer.render(AppState.viewState);
  requestMetadataUpdate();
});

// 监听鼠标交互以调整窗宽窗位 (逻辑不变)
let lastMouseX = 0;
let lastMouseY = 0;
let isMouseDown = false;

canvasContainer.addEventListener('mousedown', e => {
  isMouseDown = true;
  lastMouseX = e.pageX;
  lastMouseY = e.pageY;
  scrollAccumulator = 0; // [新增] 每次按下鼠标时重置累加器
});
canvasContainer.addEventListener('mouseup', () => {
  isMouseDown = false;
});
canvasContainer.addEventListener('mouseleave', () => {
  isMouseDown = false;
});
canvasContainer.addEventListener('mousemove', e => {
  if (isMouseDown && AppState.series.isLoaded) {
    const deltaX = e.pageX - lastMouseX;
    const deltaY = e.pageY - lastMouseY;
    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    // [核心改造] 根据当前工具模式执行不同操作
    if (AppState.uiState.tool === 'windowing') {
      // 窗宽窗位模式
      AppState.viewState.windowCenter += deltaX * 1;
      AppState.viewState.windowWidth += deltaY * 1;
      if (AppState.viewState.windowWidth < 1) AppState.viewState.windowWidth = 1;
    } else {
      // 滚动模式
      scrollAccumulator += deltaY;

      // 检查累加器是否达到阈值
      if (Math.abs(scrollAccumulator) >= SCROLL_THRESHOLD) {
        // 根据拖拽方向计算滚动的切片数
        const sliceChange = Math.floor(scrollAccumulator / SCROLL_THRESHOLD);
        AppState.viewState.sliceIndex -= sliceChange; // deltaY向下为正，索引应增加，但坐标系问题，这里用减

        // 保证索引在合法范围内
        const depth = AppState.series.depth;
        AppState.viewState.sliceIndex = Math.max(0, Math.min(AppState.viewState.sliceIndex, depth - 1));

        // 从累加器中减去已处理的部分
        scrollAccumulator -= sliceChange * SCROLL_THRESHOLD;
      }
    }

    // 统一触发重绘和UI更新
    AppState.currentRenderer.render(AppState.viewState);
    requestMetadataUpdate();
  }
});

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

// --- 5. 应用启动 ---
function main() {
  // 我们只使用WebGL渲染器
  AppState.currentRenderer = new WebGLRenderer(canvasContainer);
  AppState.currentRenderer.setFPS(parseInt(fpsInput.value, 10));
  updateToolButtons(); // [新增] 初始化时更新一次按钮状态
}

main();
