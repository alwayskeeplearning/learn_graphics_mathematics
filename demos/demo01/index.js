import dicomParser from 'dicom-parser';
import * as THREE from 'three';

// --- DOM元素获取 ---
const fileInput = document.getElementById('dicom-file-input');
const dicomMetadataDiv = document.getElementById('dicom-metadata');
const canvasContainer = document.getElementById('canvas-container');

// --- Three.js 核心对象 ---
let scene, camera, renderer, material, mesh;

// --- DICOM 数据状态 ---
let windowCenter, windowWidth;
let rescaleSlope, rescaleIntercept;

// --- 鼠标交互状态 ---
let lastMouseX = 0;
let lastMouseY = 0;
let isMouseDown = false;

// 1. 初始化Three.js场景
function initThree() {
  scene = new THREE.Scene();

  // 使用正交相机，适合2D平面渲染
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 1;

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
  canvasContainer.appendChild(renderer.domElement);

  // 启动渲染循环
  animate();
}

// 渲染循环
function animate() {
  requestAnimationFrame(animate);
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// 2. 文件加载与解析 (核心变化点)
fileInput.addEventListener('change', function (event) {
  const selectedFile = event.target.files[0];
  if (!selectedFile) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const arrayBuffer = e.target.result;
    try {
      const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));

      // 提取我们需要的元数据
      const rows = dataSet.uint16('x00280010');
      const columns = dataSet.uint16('x00280011');
      windowCenter = dataSet.floatString('x00281050', 0) || 40;
      windowWidth = dataSet.floatString('x00281051', 0) || 400;
      rescaleSlope = dataSet.floatString('x00281053') || 1;
      rescaleIntercept = dataSet.floatString('x00281052') || 0;

      // 获取原始像素数据
      const pixelDataElement = dataSet.elements.x7fe00010;
      const pixelData = new Int16Array(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);

      // *** 修复第一处: 创建整数数据纹理 ***
      const texture = new THREE.DataTexture(
        pixelData,
        columns,
        rows,
        THREE.RedIntegerFormat, // 明确告诉Three.js这是整数数据
        THREE.ShortType, // 数据类型是16位短整型
      );
      texture.needsUpdate = true;

      // *** 最终修正版: 创建完全符合Three.js最佳实践的着色器材质 ***
      material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, // 明确指定GLSL版本
        uniforms: {
          u_texture: { value: texture },
          u_windowCenter: { value: windowCenter },
          u_windowWidth: { value: windowWidth },
          u_rescaleSlope: { value: rescaleSlope },
          u_rescaleIntercept: { value: rescaleIntercept },
        },
        vertexShader: `
          // 'position' and 'uv' attributes are provided by Three.js
          // 'projectionMatrix' and 'modelViewMatrix' uniforms are provided by Three.js
          
          out vec2 vUv; // We only need to declare our varying

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        // -- Fragment Shader (最终正确版) --
        fragmentShader: `
          precision highp float;
          precision highp isampler2D;

          in vec2 vUv;
          
          // 声明一个我们自己的输出变量
          out vec4 out_FragColor;

          uniform isampler2D u_texture;
          uniform float u_windowCenter;
          uniform float u_windowWidth;
          uniform float u_rescaleSlope;
          uniform float u_rescaleIntercept;

          void main() {
            float storedValue = float(texture(u_texture, vUv).r);
            float huValue = storedValue * u_rescaleSlope + u_rescaleIntercept;
            float lowerBound = u_windowCenter - u_windowWidth / 2.0;
            float upperBound = u_windowCenter + u_windowWidth / 2.0;
            float grayValue = (huValue - lowerBound) / (upperBound - lowerBound);

            grayValue = clamp(grayValue, 0.0, 1.0);
            
            // 将最终颜色赋值给我们自己声明的输出变量
            out_FragColor = vec4(grayValue, grayValue, grayValue, 1.0);
          }
        `,
      });

      // 4. 创建一个平面来承载我们的纹理
      if (mesh) scene.remove(mesh); // 如果已有图像，先移除
      const geometry = new THREE.PlaneGeometry(columns, rows);
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // 更新相机以适应图像尺寸
      updateCamera(columns, rows);
      displayMetadata(dataSet);
    } catch (error) {
      console.error('解析或渲染DICOM失败:', error);
    }
  };
  reader.readAsArrayBuffer(selectedFile);
});

// 5. 交互逻辑更新
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
  if (isMouseDown && material) {
    const deltaX = e.pageX - lastMouseX;
    const deltaY = e.pageY - lastMouseY;

    // 直接更新uniforms的值，将新值发送给GPU
    material.uniforms.u_windowCenter.value += deltaX * 1;
    material.uniforms.u_windowWidth.value += deltaY * 1;

    // 保证窗宽不为负数
    if (material.uniforms.u_windowWidth.value < 1) {
      material.uniforms.u_windowWidth.value = 1;
    }

    lastMouseX = e.pageX;
    lastMouseY = e.pageY;

    // 更新界面显示的元数据
    displayMetadata();
  }
});

// --- 辅助函数 ---
function updateCamera(imageWidth, imageHeight) {
  const aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
  const imageAspect = imageWidth / imageHeight;

  let width, height;
  if (aspect > imageAspect) {
    height = imageHeight;
    width = height * aspect;
  } else {
    width = imageWidth;
    height = width / aspect;
  }

  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
}

function displayMetadata() {
  if (!material) return;
  dicomMetadataDiv.innerHTML = `
        <p><strong>窗位:</strong> ${material.uniforms.u_windowCenter.value.toFixed(2)}</p>
        <p><strong>窗宽:</strong> ${material.uniforms.u_windowWidth.value.toFixed(2)}</p>
        <p><i>按住鼠标在图像上拖动以调整</i></p>
        <p style="color: green;">✅ 使用GPU渲染</p>
    `;
}

// 启动！
initThree();
