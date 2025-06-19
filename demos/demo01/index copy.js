import dicomParser from 'dicom-parser';

const fileInput = document.getElementById('dicom-file-input');
const dicomMetadataDiv = document.getElementById('dicom-metadata');
const canvas = document.getElementById('dicom-canvas');
const ctx = canvas.getContext('2d');

// --- 1. 状态管理 ---
// 将这些变量提升到全局作用域，以便在多个函数间共享
let currentDataSet;
let currentArrayBuffer;
let windowCenter;
let windowWidth;

// 用于鼠标交互的状态变量
let lastMouseX = 0;
let lastMouseY = 0;
let isMouseDown = false;

fileInput.addEventListener('change', function (event) {
  const selectedFile = event.target.files[0];
  if (!selectedFile) {
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    const arrayBuffer = e.target.result;
    try {
      const byteArray = new Uint8Array(arrayBuffer);
      const dataSet = dicomParser.parseDicom(byteArray);

      // --- 保存全局状态 ---
      currentDataSet = dataSet;
      currentArrayBuffer = arrayBuffer;
      windowCenter = dataSet.floatString('x00281050', 0);
      windowWidth = dataSet.floatString('x00281051', 0);

      displayMetadata(); // 更新为不带参数，使用全局变量
      render(); // 初始渲染
    } catch (error) {
      console.error('解析DICOM文件失败:', error);
      dicomMetadataDiv.innerHTML = `<p><strong>解析状态:</strong> ❌ 失败!</p><p>${error}</p>`;
    }
  };

  reader.readAsArrayBuffer(selectedFile);
});

// --- 2. 鼠标事件监听 ---
canvas.addEventListener('mousedown', e => {
  isMouseDown = true;
  lastMouseX = e.pageX;
  lastMouseY = e.pageY;
});

canvas.addEventListener('mouseup', () => {
  isMouseDown = false;
});

canvas.addEventListener('mousemove', e => {
  if (isMouseDown) {
    const deltaX = e.pageX - lastMouseX;
    const deltaY = e.pageY - lastMouseY;

    // --- 3. 更新窗宽窗位 ---
    // 水平拖动改变窗位，垂直拖动改变窗宽
    // 这里的乘数(e.g., 1)可以调整灵敏度
    windowCenter += deltaX * 1;
    windowWidth += deltaY * 1;

    // 保证窗宽不为负数
    if (windowWidth < 1) {
      windowWidth = 1;
    }

    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    // --- 4. 重新渲染 ---
    displayMetadata(); // 更新显示的窗宽窗位值
    render(); // 用新的窗宽窗位重新渲染图像
  }
});

function displayMetadata() {
  if (!currentDataSet) return;
  const patientName = currentDataSet.string('x00100010');
  const rows = currentDataSet.uint16('x00280010');
  const columns = currentDataSet.uint16('x00280011');

  dicomMetadataDiv.innerHTML = `
        <p><strong>患者姓名:</strong> ${patientName || '未找到'}</p>
        <p><strong>图像尺寸:</strong> ${rows} x ${columns}</p>
        <p><strong>窗位:</strong> ${windowCenter.toFixed(2)}</p>
        <p><strong>窗宽:</strong> ${windowWidth.toFixed(2)}</p>
        <p><i>按住鼠标在图像上拖动以调整</i></p>
    `;
}

function render() {
  if (!currentDataSet || !currentArrayBuffer) return;

  // 1. 获取渲染所需的关键信息
  const rows = currentDataSet.uint16('x00280010');
  const columns = currentDataSet.uint16('x00280011');
  const rescaleSlope = currentDataSet.floatString('x00281053');
  const rescaleIntercept = currentDataSet.floatString('x00281052');

  // 设置canvas尺寸与图像一致
  canvas.width = columns;
  canvas.height = rows;

  // 2. 动态判断并获取像素数据
  const pixelDataElement = currentDataSet.elements.x7fe00010;

  const bitsAllocated = currentDataSet.uint16('x00280100');
  const pixelRepresentation = currentDataSet.uint16('x00280103');
  let pixelData;

  if (bitsAllocated === 16) {
    if (pixelRepresentation === 1) {
      // 16位有符号整数 -> Int16Array
      console.log('像素类型: 16-bit Signed Integer (Int16Array)');
      pixelData = new Int16Array(currentArrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
    } else {
      // 16位无符号整数 -> Uint16Array
      console.log('像素类型: 16-bit Unsigned Integer (Uint16Array)');
      pixelData = new Uint16Array(currentArrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
    }
  } else if (bitsAllocated === 8) {
    if (pixelRepresentation === 1) {
      // 8位有符号整数 -> Int8Array
      console.log('像素类型: 8-bit Signed Integer (Int8Array)');
      pixelData = new Int8Array(currentArrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length);
    } else {
      // 8位无符号整数 -> Uint8Array
      console.log('像素类型: 8-bit Unsigned Integer (Uint8Array)');
      pixelData = new Uint8Array(currentArrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length);
    }
  } else {
    // 对于我们这个教学例子，暂时不支持其他位数
    alert(`不支持的 aits allocated: ${bitsAllocated}`);
    return;
  }

  // 3. 准备Canvas的像素容器 ImageData
  // ImageData是一个包含四个值的数组 [R, G, B, A, R, G, B, A, ...]
  const imageData = ctx.createImageData(columns, rows);

  // 4. 窗宽窗位核心算法
  const lowerBound = windowCenter - windowWidth / 2;
  const upperBound = windowCenter + windowWidth / 2;

  // 遍历每一个像素
  for (let i = 0; i < pixelData.length; i++) {
    let storedValue = pixelData[i];

    // 应用 Rescale Slope/Intercept (如果存在)，得到真实的HU值
    let huValue = storedValue * (rescaleSlope || 1) + (rescaleIntercept || 0);

    // 将HU值通过窗宽窗位映射到0-255的灰度值
    let grayValue = ((huValue - lowerBound) / (upperBound - lowerBound)) * 255;

    // 限制在0-255范围内
    grayValue = Math.max(0, Math.min(255, grayValue));

    // 将灰度值填充到ImageData中。因为是灰度图，R, G, B都设为同一个值。
    // A (Alpha) 通道设为255，表示不透明。
    const index = i * 4;
    imageData.data[index] = grayValue; // R
    imageData.data[index + 1] = grayValue; // G
    imageData.data[index + 2] = grayValue; // B
    imageData.data[index + 3] = 255; // A
  }

  // 5. 将处理好的像素数据绘制到Canvas上
  ctx.putImageData(imageData, 0, 0);
}
