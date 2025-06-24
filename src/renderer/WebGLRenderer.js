import * as THREE from 'three';

// --- 着色器代码不变 ---
const SLICE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SLICE_FRAGMENT_SHADER = `
  precision highp sampler3D;
  precision highp float;

  varying vec2 vUv;
  uniform sampler3D uTexture;
  uniform float uWindowCenter;
  uniform float uWindowWidth;
  uniform float uSliceIndex;

  out vec4 out_FragColor;

  void main() {
    float z = uSliceIndex;
    float rawValue = texture(uTexture, vec3(vUv, z)).r;
    float lowerBound = uWindowCenter - uWindowWidth / 2.0;
    float upperBound = uWindowCenter + uWindowWidth / 2.0;
    float normalizedValue = (rawValue - lowerBound) / uWindowWidth;
    normalizedValue = clamp(normalizedValue, 0.0, 1.0);
    out_FragColor = vec4(vec3(normalizedValue), 1.0);
  }
`;

const VR_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VR_FRAGMENT_SHADER = `
  precision highp sampler3D;
  precision highp float;
  varying vec3 vWorldPosition;

  uniform sampler3D uVolume;
  uniform float uSteps;
  uniform float uAlphaCorrection;
  uniform float uThresholdMin;
  uniform float uThresholdMax;
  uniform bool uColorMode; // 新增：true为彩色，false为灰度

  out vec4 out_FragColor;

  // [新增] 彩色传递函数：将HU值映射为颜色
  vec4 getColorFromDensity(float density) {
    vec4 color = vec4(0.0);
    
    if (density < -900.0) {
        // 空气：透明
        color = vec4(0.0, 0.0, 0.0, 0.0);
    } else if (density < -400.0) {
        // 肺组织：粉红色
        float t = (density + 900.0) / 500.0;
        color = vec4(1.0, 0.4 + t * 0.3, 0.4 + t * 0.3, t * 0.1);
    } else if (density < -50.0) {
        // 脂肪：黄色
        float t = (density + 400.0) / 350.0;
        color = vec4(1.0, 0.8, 0.2, t * 0.3);
    } else if (density < 100.0) {
        // 软组织：红褐色
        float t = (density + 50.0) / 150.0;
        color = vec4(0.8, 0.3, 0.2, t * 0.5);
    } else if (density < 400.0) {
        // 血液/器官：深红色
        float t = (density - 100.0) / 300.0;
        color = vec4(0.6, 0.1, 0.1, t * 0.7);
      } else {
        // 骨骼：白色/米色
        float t = min((density - 400.0) / 600.0, 1.0);
        color = vec4(0.9 + t * 0.1, 0.85 + t * 0.15, 0.7 + t * 0.3, t * 0.9);
    }
    
    return color;
  }

  // [新增] 灰度传递函数：传统的阈值过滤
  vec4 getGrayscaleFromDensity(float density) {
    if (density >= uThresholdMin && density <= uThresholdMax) {
        float intensity = (density - uThresholdMin) / (uThresholdMax - uThresholdMin);
        intensity = clamp(intensity, 0.0, 1.0);
        return vec4(vec3(intensity), intensity);
    }
    return vec4(0.0);
  }

  void main() {
    vec3 rayDir = normalize(vWorldPosition - cameraPosition);
    
    // 简化的光线步进：从当前片元位置开始，向相机方向步进
    vec3 currentPos = vWorldPosition;
    vec3 step = -rayDir * (1.0 / uSteps); // 负号表示向相机方向
    
    vec4 accumulatedColor = vec4(0.0);
    
    for (float i = 0.0; i < uSteps; i += 1.0) {
        // 世界坐标转纹理坐标（假设立方体从-0.5到0.5）
        vec3 uvw = currentPos + 0.5;
        
        // [核心修复] 严格的边界检查，稍微收缩采样边界
        vec3 margin = vec3(0.01); // 1%的边距
        if (any(lessThan(uvw, margin)) || any(greaterThan(uvw, 1.0 - margin))) {
            currentPos += step;
            continue;
        }

        float rawValue = texture(uVolume, uvw).r;
        
        // [核心修复] 额外的数值检查
        if (isnan(rawValue) || isinf(rawValue)) {
            currentPos += step;
            continue;
        }
        
        // [改进] 根据模式选择传递函数
        vec4 sampleColor;
        if (uColorMode) {
            sampleColor = getColorFromDensity(rawValue);
        } else {
            sampleColor = getGrayscaleFromDensity(rawValue);
        }
        
        // 应用透明度修正
        sampleColor.a *= uAlphaCorrection;
        
        // 只有当透明度大于阈值时才进行混合
        if (sampleColor.a > 0.01) {
            accumulatedColor.rgb += (1.0 - accumulatedColor.a) * sampleColor.rgb * sampleColor.a;
            accumulatedColor.a += (1.0 - accumulatedColor.a) * sampleColor.a;
        }
        
        if (accumulatedColor.a >= 0.95) break;
        currentPos += step;
    }
    
    out_FragColor = accumulatedColor;
  }
`;

class WebGLRenderer {
  scene;
  camera;
  renderer;
  container;
  slicePlane;
  volumeBox;
  renderMode = '2d';
  viewState = {
    sliceIndex: 0,
    windowCenter: 40,
    windowWidth: 400,
    thresholdMin: 200,
    thresholdMax: 1000,
    colorMode: true, // 新增：默认使用彩色模式
  };

  constructor(container) {
    this.container = container;
    this.initScene();
    this.initRenderer();
    this.init2DPlane();
    this.init3DVolumeBox();
    this.setupEventHandlers();
  }

  initScene = () => {
    this.scene = new THREE.Scene();
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width / height;
    this.camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 0.5, -0.5, 0.1, 100);
    this.camera.position.z = 1;
  };

  initRenderer = () => {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 1);
    this.container.appendChild(this.renderer.domElement);
  };

  init2DPlane = () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: SLICE_VERTEX_SHADER,
      fragmentShader: SLICE_FRAGMENT_SHADER,
      uniforms: {
        uTexture: { value: null },
        uWindowCenter: { value: 0 },
        uWindowWidth: { value: 0 },
        uSliceIndex: { value: 0 },
      },
      glslVersion: THREE.GLSL3,
    });
    this.slicePlane = new THREE.Mesh(geometry, material);
    this.scene.add(this.slicePlane);
  };

  init3DVolumeBox = () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: VR_VERTEX_SHADER,
      fragmentShader: VR_FRAGMENT_SHADER,
      uniforms: {
        uVolume: { value: null },
        uSteps: { value: 512.0 },
        uAlphaCorrection: { value: 0.05 },
        uThresholdMin: { value: this.viewState.thresholdMin },
        uThresholdMax: { value: this.viewState.thresholdMax },
        uColorMode: { value: this.viewState.colorMode },
      },
      side: THREE.BackSide,
      transparent: true,
      glslVersion: THREE.GLSL3,
    });
    this.volumeBox = new THREE.Mesh(geometry, material);
    this.volumeBox.visible = false;
    this.scene.add(this.volumeBox);
  };

  setupEventHandlers = () => {
    window.addEventListener('resize', this.onWindowResize, false);
  };

  onWindowResize = () => {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    const aspect = width / height;

    if (this.camera.isOrthographicCamera) {
      if (this.renderMode === 'volume') {
        // 体渲染模式：使用更大的视野
        const size = 1.0;
        this.camera.left = -size * aspect;
        this.camera.right = size * aspect;
        this.camera.top = size;
        this.camera.bottom = -size;
      } else {
        // 2D切片模式：使用原有参数
        this.camera.left = -aspect / 2;
        this.camera.right = aspect / 2;
        this.camera.top = 0.5;
        this.camera.bottom = -0.5;
      }
    } else {
      this.camera.aspect = aspect;
    }
    this.camera.updateProjectionMatrix();
    this.render();
  };

  setViewState = viewState => {
    this.viewState = { ...this.viewState, ...viewState };

    // [核心修复] 在体渲染模式下，窗宽窗位需要转换为阈值范围
    if (this.renderMode === 'volume' && (viewState.windowCenter !== undefined || viewState.windowWidth !== undefined)) {
      const { windowCenter, windowWidth } = this.viewState;
      this.viewState.thresholdMin = windowCenter - windowWidth / 2;
      this.viewState.thresholdMax = windowCenter + windowWidth / 2;
    }

    this.render();
  };

  setVolume = seriesData => {
    const { width, height, depth, slices } = seriesData;
    const pixelRepresentation = slices[0].dataSet.uint16('x00280103');
    const bitsAllocated = slices[0].dataSet.uint16('x00280100');
    let TypedArray = pixelRepresentation === 1 && bitsAllocated === 16 ? Int16Array : Uint16Array;

    const integerVolumeData = new TypedArray(width * height * depth);
    for (let i = 0; i < depth; i++) {
      const pde = slices[i].dataSet.elements.x7fe00010;
      const pixelData = new TypedArray(slices[i].arrayBuffer, pde.dataOffset, width * height);
      integerVolumeData.set(pixelData, i * width * height);
    }

    const floatVolumeData = new Float32Array(integerVolumeData);

    const texture = new THREE.Data3DTexture(floatVolumeData, width, height, depth);
    texture.type = THREE.FloatType;
    texture.format = THREE.RedFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    const aspect = width / height;
    this.slicePlane.scale.set(aspect, 1, 1);

    const maxDim = Math.max(width, height, depth);
    this.volumeBox.scale.set(width / maxDim, height / maxDim, depth / maxDim);

    this.slicePlane.material.uniforms.uTexture.value = texture;
    this.volumeBox.material.uniforms.uVolume.value = texture;

    this.onWindowResize();
    this.render();
  };

  setRenderMode = mode => {
    if (this.renderMode === mode) return;
    this.renderMode = mode;
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width / height;

    if (mode === 'volume') {
      this.slicePlane.visible = false;
      this.volumeBox.visible = true;

      // [修复] 改用正交相机，消除透视变形
      const size = 1.0; // 视野大小
      this.camera = new THREE.OrthographicCamera(
        -size * aspect,
        size * aspect, // left, right
        size,
        -size, // top, bottom
        0.1,
        100, // near, far
      );
      this.camera.position.set(0, 0, 2); // 稍微远一点的观察距离
      this.camera.up.set(0, 1, 0);
    } else {
      this.slicePlane.visible = true;
      this.volumeBox.visible = false;
      this.camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 0.5, -0.5, 0.1, 100);
      this.camera.position.z = 1;
    }
    this.onWindowResize();
  };

  render = () => {
    if (!this.renderer) return;
    const { windowCenter, windowWidth, sliceIndex, alphaCorrection, steps, colorMode } = this.viewState;

    const sliceUniforms = this.slicePlane.material.uniforms;
    sliceUniforms.uWindowCenter.value = windowCenter;
    sliceUniforms.uWindowWidth.value = windowWidth;
    if (sliceUniforms.uTexture.value) {
      const depth = sliceUniforms.uTexture.value.image.depth;
      sliceUniforms.uSliceIndex.value = sliceIndex / Math.max(1, depth - 1);
    }

    const volumeUniforms = this.volumeBox.material.uniforms;
    volumeUniforms.uThresholdMin.value = this.viewState.thresholdMin;
    volumeUniforms.uThresholdMax.value = this.viewState.thresholdMax;
    volumeUniforms.uAlphaCorrection.value = alphaCorrection;
    volumeUniforms.uSteps.value = steps;
    volumeUniforms.uColorMode.value = colorMode;

    this.renderer.render(this.scene, this.camera);
  };

  getCamera = () => {
    return this.camera;
  };

  getDomElement = () => {
    return this.renderer.domElement;
  };

  // [新增] 添加resize方法作为onWindowResize的别名
  resize = () => {
    this.onWindowResize();
  };
}

export default WebGLRenderer;
