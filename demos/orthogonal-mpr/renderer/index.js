/* eslint-disable no-dupe-else-if */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { SLICE_VERTEX_SHADER, SLICE_FRAGMENT_SHADER } from './shaders';

class GpuRenderer {
  fps = 30;
  interval = 1000 / this.fps;
  lastRenderTime = 0;
  isDirty = false;
  renderRequested = false;
  // 容器
  container = null;
  // MPR方向：axial、coronal、sagittal
  orientation = null;
  // 状态改变回调
  onStateChange = null;
  // 体数据
  volume = null;
  // canvas
  canvas = null;
  // 场景
  scene = null;
  // 相机
  camera = null;
  // 渲染器
  renderer = null;
  // 切片平面
  slicePlane = null;
  // 射线投射器
  raycaster = null;
  // 十字线水平线材质（用于设置resolution保证线条的宽度在任何分辨率下都保持一致）
  crosshairsHorizontalLineMaterial = null;
  // 十字线垂直线材质（用于设置resolution保证线条的宽度在任何分辨率下都保持一致）
  crosshairsVerticalLineMaterial = null;
  // 命中框水平线材质（用于设置resolution保证线条的宽度在任何分辨率下都保持一致）
  hitboxCrosshairsHorizontalLineMaterial = null;
  // 命中框垂直线材质（用于设置resolution保证线条的宽度在任何分辨率下都保持一致）
  hitboxCrosshairsVerticalLineMaterial = null;
  // MIP厚度水平辅助线材质
  slabHorizontalLineMaterial = null;
  // MIP厚度垂直辅助线材质
  slabVerticalLineMaterial = null;
  // 命中框MIP厚度水平辅助线材质
  hitboxSlabHorizontalLineMaterial = null;
  // 命中框MIP厚度垂直辅助线材质
  hitboxSlabVerticalLineMaterial = null;
  // 线组 用于存储展示十字线和命中框十字线
  lines = {
    display: {
      crosshairs: {},
      slab: {},
    },
    hitbox: {
      crosshairs: {},
      center: {},
      slab: {},
    },
  };
  // 手柄组
  handles = {
    slab: {},
    rotate: {}, // --- 新增：用于存储旋转抓手 ---
  };
  // 十字线组
  crosshairsGroup = null;
  // 命中框组
  hitboxGroup = null;
  // 是否拖拽
  isDragging = false;
  // 拖拽目标
  dragTarget = null;
  // 拖拽起始鼠标位置 (世界坐标)
  dragStartPosition = new THREE.Vector3();
  // 拖拽起始时视图状态
  dragStartViewState = null;
  // --- 新增：用于旋转计算的起始角度 ---
  dragStartAngle = 0;
  // 是否正在进行resize
  isResizing = false;
  // resize结束的debounce定时器
  resizeEndDebounceTimer = null;
  // 当前视图状态
  viewState = null;
  // 十字线水平线位置
  xPos = 0;
  // 十字线垂直线位置
  yPos = 0;

  // --- 新增：用于缓存平面向量的属性 ---
  planeOrigin = new THREE.Vector3(0.5, 0.5, 0.5);
  planeXAxis = new THREE.Vector3(1, 0, 0);
  planeYAxis = new THREE.Vector3(0, 1, 0);
  planeNormal = new THREE.Vector3(0, 0, 1);

  constructor(container, orientation = 'axial', onStateChange = () => {}) {
    this.container = container;
    this.orientation = orientation;
    this.onStateChange = onStateChange;
    this.viewState = {
      windowCenter: 0,
      windowWidth: 0,
      position: 0,
      thickness: 0,
      axialRotation: new THREE.Quaternion(),
      coronalRotation: new THREE.Quaternion(),
      sagittalRotation: new THREE.Quaternion(),
    };
    this.planeOrigin = new THREE.Vector3();
    this.planeXAxis = new THREE.Vector3();
    this.planeYAxis = new THREE.Vector3();
    this.planeNormal = new THREE.Vector3();

    this.dragTarget = null;
    this.dragStartMouse = new THREE.Vector2();
    this.dragStartViewState = {}; // To store state at the beginning of a drag

    this.initThree();
    this.setupCrosshairs();
    this.setupThicknessControls();
    this.setupRotationControls();
    this.setupDragHandlers();
  }
  initThree() {
    const { width, height } = this.container.getBoundingClientRect();
    // 创建canvas
    this.canvas = document.createElement('canvas');
    this.canvas.dataset.orientation = this.orientation;
    this.container.appendChild(this.canvas);

    // 创建场景
    this.scene = new THREE.Scene();

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, preserveDrawingBuffer: true, antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 1);

    // 创建相机
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    this.camera.position.z = 1;

    // 创建切片平面
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: SLICE_VERTEX_SHADER,
      fragmentShader: SLICE_FRAGMENT_SHADER,
      uniforms: {
        u_texture: { value: null },
        u_textureSize: { value: new THREE.Vector3() },
        u_plane_origin: { value: new THREE.Vector3() },
        u_plane_xAxis: { value: new THREE.Vector3() },
        u_plane_yAxis: { value: new THREE.Vector3() },
        u_plane_normal: { value: new THREE.Vector3() },
        u_windowCenter: { value: 0 },
        u_windowWidth: { value: 1 },
        u_rescaleSlope: { value: 1 },
        u_rescaleIntercept: { value: 0 },
        u_minPixelValue: { value: 0 },
        u_maxPixelValue: { value: 1 },
        u_slabMode: { value: 0 },
        u_slabThickness: { value: 0 },
      },
      glslVersion: THREE.GLSL3,
    });
    this.slicePlane = new THREE.Mesh(geometry, material);
    this.scene.add(this.slicePlane);

    // 创建射线投射器
    this.raycaster = new THREE.Raycaster();
  }
  dispose() {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  }
  resize() {
    this.isResizing = true;
    if (this.resizeEndDebounceTimer) {
      clearTimeout(this.resizeEndDebounceTimer);
    }
    this.resizeEndDebounceTimer = setTimeout(() => {
      this.isResizing = false;
    }, 100); // 如果100毫秒内没有新的resize事件，就认为resize结束了

    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    const viewportAspect = width / height;

    // 修正：内容尺寸不再是写死的1x1，而是由slicePlane的缩放决定
    const contentWidth = this.slicePlane.scale.x;
    const contentHeight = this.slicePlane.scale.y;
    const contentAspect = contentWidth / contentHeight;

    if (viewportAspect > contentAspect) {
      // 情况1：窗口比内容更"宽"，以内容高度为基准，左右留黑 (Pillarbox)
      const cameraHeight = contentHeight;
      const cameraWidth = cameraHeight * viewportAspect;
      this.camera.top = cameraHeight / 2;
      this.camera.bottom = -cameraHeight / 2;
      this.camera.left = -cameraWidth / 2;
      this.camera.right = cameraWidth / 2;
    } else {
      // 情况2：窗口比内容更"高"，以内容宽度为基准，上下留黑 (Letterbox)
      const cameraWidth = contentWidth;
      const cameraHeight = cameraWidth / viewportAspect;
      this.camera.left = -cameraWidth / 2;
      this.camera.right = cameraWidth / 2;
      this.camera.top = cameraHeight / 2;
      this.camera.bottom = -cameraHeight / 2;
    }

    this.camera.updateProjectionMatrix();

    const allLineMaterials = [this.crosshairsHorizontalLineMaterial, this.crosshairsVerticalLineMaterial, this.hitboxCrosshairsHorizontalLineMaterial, this.hitboxCrosshairsVerticalLineMaterial, this.slabHorizontalLineMaterial, this.slabVerticalLineMaterial, this.hitboxSlabHorizontalLineMaterial, this.hitboxSlabVerticalLineMaterial];

    allLineMaterials.forEach(material => {
      if (material) {
        material.resolution.set(width, height);
      }
    });
    this.invalidate();
  }
  setVolume(seriesDicomData, texture3D) {
    this.volume = seriesDicomData;
    const { data, metaData } = this.volume;
    const { width, height, depth, windowCenter, windowWidth, rescaleSlope, rescaleIntercept } = metaData;

    let TypedArray = data[0].pixelData.constructor;
    const integerVolumeData = new TypedArray(width * height * depth);
    data.forEach((slice, i) => {
      const pixelData = slice.pixelData;
      integerVolumeData.set(pixelData, i * width * height);
    });
    const floatVolumeData = new Float32Array(integerVolumeData);
    let texture = null;
    if (texture3D) {
      texture = texture3D;
    } else {
      texture = new THREE.Data3DTexture(floatVolumeData, width, height, depth);
      texture.type = THREE.FloatType;
      texture.format = THREE.RedFormat;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
    }

    this.slicePlane.material.uniforms.u_texture.value = texture;
    this.slicePlane.material.uniforms.u_textureSize.value = new THREE.Vector3(width, height, depth);
    this.slicePlane.material.uniforms.u_minPixelValue.value = metaData.minPixelValue;
    this.slicePlane.material.uniforms.u_maxPixelValue.value = metaData.maxPixelValue;
    this.slicePlane.material.uniforms.u_windowWidth.value = windowWidth;
    this.slicePlane.material.uniforms.u_windowCenter.value = windowCenter;
    this.slicePlane.material.uniforms.u_rescaleSlope.value = rescaleSlope;
    this.slicePlane.material.uniforms.u_rescaleIntercept.value = rescaleIntercept;

    // 由于我们不再修改defines，此行已不再需要，故移除。
    // this.slicePlane.material.needsUpdate = true;
    return texture;
  }
  render(viewState) {
    this.viewState = viewState;
    if (!this.volume) {
      this.invalidate();
      return;
    }

    const uniforms = this.slicePlane.material.uniforms;
    const { windowCenter, windowWidth, slabMode } = viewState;
    const { axialPosition, coronalPosition, sagittalPosition, axialThickness, coronalThickness, sagittalThickness } = viewState;
    // --- 恢复：各自读取自己的旋转状态 ---
    const { axialRotation, coronalRotation, sagittalRotation } = viewState;
    const { metaData } = this.volume;
    const { width, height, depth, pixelSpacing, sliceThickness, sliceSpacing } = metaData;

    uniforms.u_windowCenter.value = windowCenter;
    uniforms.u_windowWidth.value = windowWidth;
    uniforms.u_slabMode.value = slabMode || 0;

    // --- 核心改造: 计算平面向量 ---
    const physicalWidth = width * (pixelSpacing ? pixelSpacing[1] : 1);
    const physicalHeight = height * (pixelSpacing ? pixelSpacing[0] : 1);
    const physicalDepth = sliceSpacing * (depth - 1) + sliceThickness;
    const maxDim = Math.max(physicalWidth, physicalHeight, physicalDepth);

    const texSpaceWidth = physicalWidth / maxDim;
    const texSpaceHeight = physicalHeight / maxDim;
    const texSpaceDepth = physicalDepth / maxDim;

    let verticalSlabThickness = 0.0;
    let horizontalSlabThickness = 0.0;

    // --- 恢复：根据视图类型选择对应的旋转状态 ---
    let rotation;
    switch (this.orientation) {
      case 'axial':
        rotation = axialRotation;
        this.planeOrigin.set(0.5, 0.5, (axialPosition + 0.5) / depth);
        this.planeXAxis.set(texSpaceWidth, 0, 0);
        this.planeYAxis.set(0, texSpaceHeight, 0);
        this.planeNormal.set(0, 0, 1);
        uniforms.u_slabThickness.value = axialThickness || 0.0;
        this.xPos = (sagittalPosition / (width - 1) - 0.5) * texSpaceWidth;
        this.yPos = (0.5 - coronalPosition / (height - 1)) * texSpaceHeight;
        verticalSlabThickness = viewState.sagittalThickness || 0.0;
        horizontalSlabThickness = viewState.coronalThickness || 0.0;
        break;
      case 'coronal':
        rotation = coronalRotation;
        this.planeOrigin.set(0.5, (coronalPosition + 0.5) / height, 0.5);
        this.planeXAxis.set(texSpaceWidth, 0, 0);
        this.planeYAxis.set(0, 0, texSpaceDepth);
        this.planeNormal.set(0, 1, 0);
        uniforms.u_slabThickness.value = coronalThickness || 0.0;
        this.xPos = (sagittalPosition / (width - 1) - 0.5) * texSpaceWidth;
        this.yPos = (0.5 - axialPosition / (depth - 1)) * texSpaceDepth;
        verticalSlabThickness = viewState.sagittalThickness || 0.0;
        horizontalSlabThickness = viewState.axialThickness || 0.0;
        break;
      case 'sagittal':
        rotation = sagittalRotation;
        this.planeOrigin.set((sagittalPosition + 0.5) / width, 0.5, 0.5);
        this.planeXAxis.set(0, texSpaceHeight, 0);
        this.planeYAxis.set(0, 0, texSpaceDepth);
        this.planeNormal.set(1, 0, 0);
        uniforms.u_slabThickness.value = sagittalThickness || 0.0;
        this.xPos = (coronalPosition / (height - 1) - 0.5) * texSpaceHeight;
        this.yPos = (0.5 - axialPosition / (depth - 1)) * texSpaceDepth;
        verticalSlabThickness = viewState.coronalThickness || 0.0;
        horizontalSlabThickness = viewState.axialThickness || 0.0;
        break;
    }

    // --- 应用当前视图对应的旋转 ---
    this.planeXAxis.applyQuaternion(rotation);
    this.planeYAxis.applyQuaternion(rotation);
    this.planeNormal.applyQuaternion(rotation);

    // 根据习惯，Y轴在屏幕上是向下的，但我们的v_texCoord.y是向上的。
    this.planeYAxis.negate();

    uniforms.u_plane_origin.value.copy(this.planeOrigin);
    uniforms.u_plane_xAxis.value.copy(this.planeXAxis);
    uniforms.u_plane_yAxis.value.copy(this.planeYAxis);
    uniforms.u_plane_normal.value.copy(this.planeNormal);

    // --- 修正：根据向量长度，正确缩放平面以保证宽高比 ---
    if (Math.abs(this.planeYAxis.length()) > 1e-6) {
      const oldAspect = this.slicePlane.scale.x / this.slicePlane.scale.y;
      const newAspect = this.planeXAxis.length() / this.planeYAxis.length();

      // 当宽高比发生显著变化时，更新平面缩放并强制重新校准相机
      if (Math.abs(newAspect - oldAspect) > 1e-6) {
        this.slicePlane.scale.set(this.planeXAxis.length(), this.planeYAxis.length(), 1);
        this.resize(); // 强制相机根据新的宽高比进行更新
      }
    }

    // --- 更新十字线和辅助线 ---
    const { left, right, top, bottom } = this.camera;
    const gap = 0.05 * Math.min(this.slicePlane.scale.x, this.slicePlane.scale.y); // 让gap也自适应
    const zOffset = 0.01;

    const leftHPoints = [left, this.yPos, zOffset, this.xPos - gap, this.yPos, zOffset];
    const rightHPoints = [this.xPos + gap, this.yPos, zOffset, right, this.yPos, zOffset];
    const bottomVPoints = [this.xPos, bottom, zOffset, this.xPos, this.yPos - gap, zOffset];
    const topVPoints = [this.xPos, this.yPos + gap, zOffset, this.xPos, top, zOffset];

    this.lines.display.crosshairs.leftHorizontalLine.geometry.setPositions(leftHPoints);
    this.lines.display.crosshairs.rightHorizontalLine.geometry.setPositions(rightHPoints);
    this.lines.display.crosshairs.bottomVerticalLine.geometry.setPositions(bottomVPoints);
    this.lines.display.crosshairs.topVerticalLine.geometry.setPositions(topVPoints);
    this.lines.hitbox.crosshairs.leftHorizontalLine.geometry.setPositions(leftHPoints);
    this.lines.hitbox.crosshairs.rightHorizontalLine.geometry.setPositions(rightHPoints);
    this.lines.hitbox.crosshairs.bottomVerticalLine.geometry.setPositions(bottomVPoints);
    this.lines.hitbox.crosshairs.topVerticalLine.geometry.setPositions(topVPoints);
    this.lines.hitbox.center.position.set(this.xPos, this.yPos, zOffset);

    // --- 修正：更新旋转抓手的位置 ---
    const handleOffset = 0.02; // 抓手距离线端点的距离
    this.handles.rotate.hStart.position.set(left + handleOffset, this.yPos, zOffset + 0.01);
    this.handles.rotate.hEnd.position.set(right - handleOffset, this.yPos, zOffset + 0.01);
    this.handles.rotate.vStart.position.set(this.xPos, top - handleOffset, zOffset + 0.01);
    this.handles.rotate.vEnd.position.set(this.xPos, bottom + handleOffset, zOffset + 0.01);

    const hasSlab = verticalSlabThickness > 0.0 || horizontalSlabThickness > 0.0;

    this.lines.display.slab.topHorizontalLine.visible = hasSlab;
    this.lines.display.slab.bottomHorizontalLine.visible = hasSlab;
    this.lines.display.slab.leftVerticalLine.visible = hasSlab;
    this.lines.display.slab.rightVerticalLine.visible = hasSlab;
    this.lines.hitbox.slab.topHorizontalLine.visible = hasSlab;
    this.lines.hitbox.slab.bottomHorizontalLine.visible = hasSlab;
    this.lines.hitbox.slab.leftVerticalLine.visible = hasSlab;
    this.lines.hitbox.slab.rightVerticalLine.visible = hasSlab;

    let verticalOffset = 0;
    let horizontalOffset = 0;

    if (this.orientation === 'axial') {
      verticalOffset = (verticalSlabThickness / 2 / width) * texSpaceWidth;
      horizontalOffset = (horizontalSlabThickness / 2 / height) * texSpaceHeight;
    } else if (this.orientation === 'coronal') {
      verticalOffset = (verticalSlabThickness / 2 / width) * texSpaceWidth;
      horizontalOffset = (horizontalSlabThickness / 2 / depth) * texSpaceDepth;
    } else {
      verticalOffset = (verticalSlabThickness / 2 / height) * texSpaceHeight;
      horizontalOffset = (horizontalSlabThickness / 2 / depth) * texSpaceDepth;
    }

    const hTop = this.yPos + horizontalOffset;
    const hBottom = this.yPos - horizontalOffset;
    this.lines.display.slab.topHorizontalLine.geometry.setPositions([left, hTop, zOffset, right, hTop, zOffset]);
    this.lines.display.slab.bottomHorizontalLine.geometry.setPositions([left, hBottom, zOffset, right, hBottom, zOffset]);
    this.lines.hitbox.slab.topHorizontalLine.geometry.setPositions([left, hTop, zOffset, right, hTop, zOffset]);
    this.lines.hitbox.slab.bottomHorizontalLine.geometry.setPositions([left, hBottom, zOffset, right, hBottom, zOffset]);

    const vLeft = this.xPos - verticalOffset;
    const vRight = this.xPos + verticalOffset;
    this.lines.display.slab.leftVerticalLine.geometry.setPositions([vLeft, bottom, zOffset, vLeft, top, zOffset]);
    this.lines.display.slab.rightVerticalLine.geometry.setPositions([vRight, top, zOffset, vRight, bottom, zOffset]);
    this.lines.hitbox.slab.leftVerticalLine.geometry.setPositions([vLeft, bottom, zOffset, vLeft, top, zOffset]);
    this.lines.hitbox.slab.rightVerticalLine.geometry.setPositions([vRight, top, zOffset, vRight, bottom, zOffset]);

    this.lines.display.slab.topHorizontalLine.computeLineDistances();
    this.lines.display.slab.bottomHorizontalLine.computeLineDistances();
    this.lines.display.slab.leftVerticalLine.computeLineDistances();
    this.lines.display.slab.rightVerticalLine.computeLineDistances();

    const handlePosOffset = 0.2;
    this.handles.slab.topHorizontalLeft.position.set(this.xPos - handlePosOffset, hTop, zOffset + 0.01);
    this.handles.slab.topHorizontalRight.position.set(this.xPos + handlePosOffset, hTop, zOffset + 0.01);
    this.handles.slab.bottomHorizontalLeft.position.set(this.xPos - handlePosOffset, hBottom, zOffset + 0.01);
    this.handles.slab.bottomHorizontalRight.position.set(this.xPos + handlePosOffset, hBottom, zOffset + 0.01);
    this.handles.slab.leftVerticalTop.position.set(vLeft, this.yPos + handlePosOffset, zOffset + 0.01);
    this.handles.slab.rightVerticalTop.position.set(vRight, this.yPos + handlePosOffset, zOffset + 0.01);
    this.handles.slab.leftVerticalBottom.position.set(vLeft, this.yPos - handlePosOffset, zOffset + 0.01);
    this.handles.slab.rightVerticalBottom.position.set(vRight, this.yPos - handlePosOffset, zOffset + 0.01);

    this.invalidate();
  }
  setupCrosshairs() {
    // .axial-label { color: #00ffff; }   // 青色 - 轴状位
    // .coronal-label { color: #ff00ff; } // 品红 - 冠状位
    // .sagittal-label { color:rgb(255, 174, 0); }// 黄色 - 矢状位
    const { width, height } = this.container.getBoundingClientRect();

    // 创建十字线组
    this.crosshairsGroup = new THREE.Group();
    this.scene.add(this.crosshairsGroup);
    // 创建命中框十字线组
    this.hitboxGroup = new THREE.Group();
    this.scene.add(this.hitboxGroup);

    let horizontalColor, verticalColor;

    if (this.orientation === 'axial') {
      // 水平线代表冠状位(X), 垂直线代表矢状位(Y)
      horizontalColor = 0xff00ff; // Coronal
      verticalColor = 0xffae00; // Sagittal
    } else if (this.orientation === 'coronal') {
      // 水平线代表轴状位(X), 垂直线代表矢状位(Z)
      horizontalColor = 0x00ffff; // Axial
      verticalColor = 0xffae00; // Sagittal
    } else if (this.orientation === 'sagittal') {
      // 水平线代表轴状位(Y), 垂直线代表冠状位(Z)
      horizontalColor = 0x00ffff; // Axial
      verticalColor = 0xff00ff; // Coronal
    }

    // 十字线材质
    const lineOptions = {
      linewidth: 2,
      transparent: true,
      opacity: 0.7,
      // 设置线材质的分辨率，确保线在屏幕上显示正常
      resolution: new THREE.Vector2(width, height),
    };

    // 命中框十字线材质 较宽的hitbox便于鼠标悬停检测
    const hitboxLineOptions = {
      linewidth: 10,
      transparent: true,
      opacity: 0.0,
      resolution: new THREE.Vector2(width, height),
    };

    this.crosshairsHorizontalLineMaterial = new LineMaterial({ ...lineOptions, color: horizontalColor });
    this.crosshairsVerticalLineMaterial = new LineMaterial({ ...lineOptions, color: verticalColor });
    this.hitboxCrosshairsHorizontalLineMaterial = new LineMaterial({ ...hitboxLineOptions, color: horizontalColor });
    this.hitboxCrosshairsVerticalLineMaterial = new LineMaterial({ ...hitboxLineOptions, color: verticalColor });

    // Geometries will be initialized empty and updated in the render loop.
    // 创建展示十字线和命中框十字线几何体 是空的 在render中更新对应几何体的position
    const baseGeometry = new LineGeometry();

    // --- 展示十字线 ---
    this.lines.display.crosshairs.leftHorizontalLine = new Line2(baseGeometry.clone(), this.crosshairsHorizontalLineMaterial);
    this.lines.display.crosshairs.rightHorizontalLine = new Line2(baseGeometry.clone(), this.crosshairsHorizontalLineMaterial);
    this.lines.display.crosshairs.bottomVerticalLine = new Line2(baseGeometry.clone(), this.crosshairsVerticalLineMaterial);
    this.lines.display.crosshairs.topVerticalLine = new Line2(baseGeometry.clone(), this.crosshairsVerticalLineMaterial);
    this.crosshairsGroup.add(this.lines.display.crosshairs.leftHorizontalLine, this.lines.display.crosshairs.rightHorizontalLine, this.lines.display.crosshairs.bottomVerticalLine, this.lines.display.crosshairs.topVerticalLine);

    // --- 命中框十字线 ---
    this.lines.hitbox.crosshairs.leftHorizontalLine = new Line2(baseGeometry.clone(), this.hitboxCrosshairsHorizontalLineMaterial);
    this.lines.hitbox.crosshairs.leftHorizontalLine.userData.type = 'crosshairs_horizontal_line';
    this.lines.hitbox.crosshairs.rightHorizontalLine = new Line2(baseGeometry.clone(), this.hitboxCrosshairsHorizontalLineMaterial);
    this.lines.hitbox.crosshairs.rightHorizontalLine.userData.type = 'crosshairs_horizontal_line';
    this.lines.hitbox.crosshairs.bottomVerticalLine = new Line2(baseGeometry.clone(), this.hitboxCrosshairsVerticalLineMaterial);
    this.lines.hitbox.crosshairs.bottomVerticalLine.userData.type = 'crosshairs_vertical_line';
    this.lines.hitbox.crosshairs.topVerticalLine = new Line2(baseGeometry.clone(), this.hitboxCrosshairsVerticalLineMaterial);
    this.lines.hitbox.crosshairs.topVerticalLine.userData.type = 'crosshairs_vertical_line';
    this.hitboxGroup.add(this.lines.hitbox.crosshairs.leftHorizontalLine, this.lines.hitbox.crosshairs.rightHorizontalLine, this.lines.hitbox.crosshairs.bottomVerticalLine, this.lines.hitbox.crosshairs.topVerticalLine);

    // --- 命中框中心方框 ---
    const centerGeometry = new THREE.PlaneGeometry(0.1, 0.1);
    const centerMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    this.lines.hitbox.center = new THREE.Mesh(centerGeometry, centerMaterial);
    this.lines.hitbox.center.userData.type = 'center';
    this.hitboxGroup.add(this.lines.hitbox.center);

    // --- 新增：创建旋转抓手 ---
    const rotateHandleGeometry = new THREE.CircleGeometry(0.015, 16);
    // 修正：为水平和垂直抓手创建独立的、颜色正确的材质
    const rotateHandleMaterialH = new THREE.MeshBasicMaterial({ color: horizontalColor, transparent: true, opacity: 0.9 });
    const rotateHandleMaterialV = new THREE.MeshBasicMaterial({ color: verticalColor, transparent: true, opacity: 0.9 });

    this.handles.rotate.hStart = new THREE.Mesh(rotateHandleGeometry.clone(), rotateHandleMaterialH);
    this.handles.rotate.hStart.userData.type = 'rotate_h';
    this.handles.rotate.hEnd = new THREE.Mesh(rotateHandleGeometry.clone(), rotateHandleMaterialH);
    this.handles.rotate.hEnd.userData.type = 'rotate_h';
    this.handles.rotate.vStart = new THREE.Mesh(rotateHandleGeometry.clone(), rotateHandleMaterialV);
    this.handles.rotate.vStart.userData.type = 'rotate_v';
    this.handles.rotate.vEnd = new THREE.Mesh(rotateHandleGeometry.clone(), rotateHandleMaterialV);
    this.handles.rotate.vEnd.userData.type = 'rotate_v';

    this.hitboxGroup.add(this.handles.rotate.hStart, this.handles.rotate.hEnd, this.handles.rotate.vStart, this.handles.rotate.vEnd);
  }
  setupThicknessControls() {
    const { width, height } = this.container.getBoundingClientRect();

    // mip厚度辅助线材质
    const lineOptions = {
      linewidth: 1,
      dashed: true,
      dashSize: 0.01,
      gapSize: 0.01,
      resolution: new THREE.Vector2(width, height),
      transparent: true,
      opacity: 0.7,
    };

    // 命中框厚度辅助线材质 较宽的hitbox便于鼠标悬停检测
    const hitboxLineOptions = {
      linewidth: 10,
      transparent: true,
      opacity: 0.0,
      resolution: new THREE.Vector2(width, height),
    };

    // 厚度手柄大小
    const handleSize = 0.018;
    const handleGeometry = new THREE.PlaneGeometry(handleSize + 0.001, handleSize);

    const slabHorizontalHandleMaterial = new THREE.MeshBasicMaterial({ color: this.crosshairsHorizontalLineMaterial.color, transparent: true, opacity: 0.7 });
    const slabVerticalHandleMaterial = new THREE.MeshBasicMaterial({ color: this.crosshairsVerticalLineMaterial.color, transparent: true, opacity: 0.7 });
    this.slabHorizontalLineMaterial = new LineMaterial({ ...lineOptions, color: this.crosshairsHorizontalLineMaterial.color });
    this.slabVerticalLineMaterial = new LineMaterial({ ...lineOptions, color: this.crosshairsVerticalLineMaterial.color });
    this.hitboxSlabHorizontalLineMaterial = new LineMaterial({ ...hitboxLineOptions, color: this.crosshairsHorizontalLineMaterial.color });
    this.hitboxSlabVerticalLineMaterial = new LineMaterial({ ...hitboxLineOptions, color: this.crosshairsVerticalLineMaterial.color });

    // 展示MIP厚度辅助线
    this.lines.display.slab.topHorizontalLine = new Line2(new LineGeometry(), this.slabHorizontalLineMaterial);
    this.lines.display.slab.bottomHorizontalLine = new Line2(new LineGeometry(), this.slabHorizontalLineMaterial);
    this.lines.display.slab.leftVerticalLine = new Line2(new LineGeometry(), this.slabVerticalLineMaterial);
    this.lines.display.slab.rightVerticalLine = new Line2(new LineGeometry(), this.slabVerticalLineMaterial);

    // 命中框MIP厚度辅助线（hitbox）
    this.lines.hitbox.slab.topHorizontalLine = new Line2(new LineGeometry(), this.hitboxSlabHorizontalLineMaterial);
    this.lines.hitbox.slab.topHorizontalLine.userData.type = 'slab_horizontal_line';
    this.lines.hitbox.slab.bottomHorizontalLine = new Line2(new LineGeometry(), this.hitboxSlabHorizontalLineMaterial);
    this.lines.hitbox.slab.bottomHorizontalLine.userData.type = 'slab_horizontal_line';
    this.lines.hitbox.slab.leftVerticalLine = new Line2(new LineGeometry(), this.hitboxSlabVerticalLineMaterial);
    this.lines.hitbox.slab.leftVerticalLine.userData.type = 'slab_vertical_line';
    this.lines.hitbox.slab.rightVerticalLine = new Line2(new LineGeometry(), this.hitboxSlabVerticalLineMaterial);
    this.lines.hitbox.slab.rightVerticalLine.userData.type = 'slab_vertical_line';

    // MIP厚度手柄
    this.handles.slab.topHorizontalLeft = new THREE.Mesh(handleGeometry, slabHorizontalHandleMaterial);
    this.handles.slab.topHorizontalLeft.userData.type = 'slab_horizontal_handle';
    this.handles.slab.topHorizontalRight = new THREE.Mesh(handleGeometry, slabHorizontalHandleMaterial);
    this.handles.slab.topHorizontalRight.userData.type = 'slab_horizontal_handle';
    this.handles.slab.bottomHorizontalLeft = new THREE.Mesh(handleGeometry, slabHorizontalHandleMaterial);
    this.handles.slab.bottomHorizontalLeft.userData.type = 'slab_horizontal_handle';
    this.handles.slab.bottomHorizontalRight = new THREE.Mesh(handleGeometry, slabHorizontalHandleMaterial);
    this.handles.slab.bottomHorizontalRight.userData.type = 'slab_horizontal_handle';
    this.handles.slab.leftVerticalTop = new THREE.Mesh(handleGeometry, slabVerticalHandleMaterial);
    this.handles.slab.leftVerticalTop.userData.type = 'slab_vertical_handle';
    this.handles.slab.leftVerticalBottom = new THREE.Mesh(handleGeometry, slabVerticalHandleMaterial);
    this.handles.slab.leftVerticalBottom.userData.type = 'slab_vertical_handle';
    this.handles.slab.rightVerticalTop = new THREE.Mesh(handleGeometry, slabVerticalHandleMaterial);
    this.handles.slab.rightVerticalTop.userData.type = 'slab_vertical_handle';
    this.handles.slab.rightVerticalBottom = new THREE.Mesh(handleGeometry, slabVerticalHandleMaterial);
    this.handles.slab.rightVerticalBottom.userData.type = 'slab_vertical_handle';

    // 将MIP厚度辅助线添加到场景中
    this.scene.add(this.lines.display.slab.topHorizontalLine, this.lines.display.slab.bottomHorizontalLine, this.lines.display.slab.leftVerticalLine, this.lines.display.slab.rightVerticalLine);

    // 将MIP厚度辅助线（hitbox）添加到hitboxGroup中
    this.hitboxGroup.add(this.lines.hitbox.slab.topHorizontalLine, this.lines.hitbox.slab.bottomHorizontalLine, this.lines.hitbox.slab.leftVerticalLine, this.lines.hitbox.slab.rightVerticalLine);

    // 将MIP厚度手柄添加到hitboxGroup中
    this.hitboxGroup.add(this.handles.slab.topHorizontalLeft, this.handles.slab.topHorizontalRight, this.handles.slab.bottomHorizontalLeft, this.handles.slab.bottomHorizontalRight, this.handles.slab.leftVerticalTop, this.handles.slab.leftVerticalBottom, this.handles.slab.rightVerticalTop, this.handles.slab.rightVerticalBottom);

    // 默认全部隐藏
    Object.values(this.lines.display.slab).forEach(line => (line.visible = false));
    Object.values(this.handles.slab).forEach(handle => (handle.visible = false));
  }
  setupRotationControls() {
    // 旋转圆形手柄大小
    const handleSize = 0.012;
    const handleGeometry = new THREE.CircleGeometry(handleSize, 16);

    const rotationHorizontalHandleMaterial = new THREE.MeshBasicMaterial({ color: this.crosshairsHorizontalLineMaterial.color, transparent: true, opacity: 0.7 });
    const rotationVerticalHandleMaterial = new THREE.MeshBasicMaterial({ color: this.crosshairsVerticalLineMaterial.color, transparent: true, opacity: 0.7 });

    // MIP厚度手柄
    this.handles.rotation.horizontalLeft = new THREE.Mesh(handleGeometry, rotationHorizontalHandleMaterial);
    this.handles.rotation.horizontalLeft.userData.type = 'rotation_horizontal_handle';
    this.handles.rotation.horizontalRight = new THREE.Mesh(handleGeometry, rotationHorizontalHandleMaterial);
    this.handles.rotation.horizontalRight.userData.type = 'rotation_horizontal_handle';
    this.handles.rotation.verticalTop = new THREE.Mesh(handleGeometry, rotationVerticalHandleMaterial);
    this.handles.rotation.verticalTop.userData.type = 'rotation_vertical_handle';
    this.handles.rotation.verticalBottom = new THREE.Mesh(handleGeometry, rotationVerticalHandleMaterial);
    this.handles.rotation.verticalBottom.userData.type = 'rotation_vertical_handle';

    // 将旋转圆形手柄添加到hitboxGroup中
    this.hitboxGroup.add(this.handles.rotation.horizontalLeft, this.handles.rotation.horizontalRight, this.handles.rotation.verticalTop, this.handles.rotation.verticalBottom);

    Object.values(this.handles.rotation).forEach(handle => (handle.visible = false));
  }
  setupDragHandlers() {
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);

    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
  }
  // 归一化鼠标坐标
  getNormalizedMousePosition(event) {
    const { width, height, left, top } = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - left) / width) * 2 - 1;
    mouse.y = -((event.clientY - top) / height) * 2 + 1;
    return mouse;
  }
  handleMouseDown(event) {
    event.preventDefault();
    // 临时解决窗宽窗位等工具与拖拽的冲突
    this.isUIDragging = true;
    // 只处理左键点击
    if (event.button !== 0) return;

    const mouse = this.getNormalizedMousePosition(event);
    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.hitboxGroup.children, true);

    console.log(
      'mousedown intersects:',
      intersects.length,
      intersects.map(i => i.object.userData.type),
    );

    if (intersects.length > 0) {
      this.isDragging = true;
      this.isUIDragging = false;
      this.dragTarget = intersects[0].object.userData.type;

      console.log('dragTarget set to:', this.dragTarget);

      // 将屏幕坐标转换为世界坐标并存储
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      this.raycaster.ray.intersectPlane(plane, this.dragStartPosition);
      this.dragStartViewState = { ...this.viewState }; // Store a copy of the state at drag start

      // --- 新增：为旋转操作存储起始角度 ---
      if (this.dragTarget.startsWith('rotate_')) {
        const centerPoint = new THREE.Vector3(this.xPos, this.yPos, 0);
        const startVector = new THREE.Vector3().subVectors(this.dragStartPosition, centerPoint);
        this.dragStartAngle = Math.atan2(startVector.y, startVector.x);
      }
    }
  }
  handleMouseMove(event) {
    if (!this.isDragging && !this.isUIDragging) {
      const mouse = this.getNormalizedMousePosition(event);
      this.raycaster.setFromCamera(mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.hitboxGroup.children, true);
      Object.values(this.handles.slab).forEach(slabHandle => (slabHandle.visible = false));
      Object.values(this.handles.rotation).forEach(rotationHandle => (rotationHandle.visible = false));
      this.dragTarget = null;
      if (intersects.length > 0) {
        this.dragTarget = intersects[0].object.userData.type;
        // console.log(this.dragTarget);
        // 根据悬停的对象类型，显示对应的手柄
        if (this.dragTarget === 'crosshairs_horizontal_line' || this.dragTarget === 'slab_horizontal_handle' || this.dragTarget === 'rotation_horizontal_handle') {
          // 悬停在十字线的水平部分，显示水平方向的厚度手柄
          this.handles.slab.topHorizontalLeft.visible = true;
          this.handles.slab.topHorizontalRight.visible = true;
          this.handles.slab.bottomHorizontalLeft.visible = true;
          this.handles.slab.bottomHorizontalRight.visible = true;
          this.canvas.style.cursor = 'row-resize';
          if (this.dragTarget === 'crosshairs_horizontal_line' || this.dragTarget === 'rotation_horizontal_handle') {
            this.handles.rotation.horizontalLeft.visible = true;
            this.handles.rotation.horizontalRight.visible = true;
            this.handles.rotation.verticalTop.visible = true;
            this.handles.rotation.verticalBottom.visible = true;
            if (this.dragTarget === 'rotation_horizontal_handle') {
              this.canvas.style.cursor = 'grab';
            }
          }
        } else if (this.dragTarget === 'crosshairs_vertical_line' || this.dragTarget === 'slab_vertical_handle' || this.dragTarget === 'rotation_vertical_handle') {
          // 悬停在十字线的垂直部分，显示垂直方向的厚度手柄
          this.handles.slab.leftVerticalTop.visible = true;
          this.handles.slab.leftVerticalBottom.visible = true;
          this.handles.slab.rightVerticalTop.visible = true;
          this.handles.slab.rightVerticalBottom.visible = true;
          this.canvas.style.cursor = 'col-resize';
          if (this.dragTarget === 'crosshairs_vertical_line' || this.dragTarget === 'rotation_vertical_handle') {
            this.handles.rotation.horizontalLeft.visible = true;
            this.handles.rotation.horizontalRight.visible = true;
            this.handles.rotation.verticalTop.visible = true;
            this.handles.rotation.verticalBottom.visible = true;
            if (this.dragTarget === 'rotation_vertical_handle') {
              this.canvas.style.cursor = 'grab';
            }
          }
        } else if (this.dragTarget === 'slab_horizontal_line') {
          // 悬停在水平厚度辅助线，显示水平方向的厚度手柄
          this.handles.slab.topHorizontalLeft.visible = true;
          this.handles.slab.topHorizontalRight.visible = true;
          this.handles.slab.bottomHorizontalLeft.visible = true;
          this.handles.slab.bottomHorizontalRight.visible = true;
        } else if (this.dragTarget === 'slab_vertical_line') {
          // ----------------------------------------------------------------
          // 悬停在垂直厚度辅助线，显示垂直方向的厚度手柄
          this.handles.slab.leftVerticalTop.visible = true;
          this.handles.slab.leftVerticalBottom.visible = true;
          this.handles.slab.rightVerticalTop.visible = true;
          this.handles.slab.rightVerticalBottom.visible = true;
        } else if (this.dragTarget === 'center') {
          this.canvas.style.cursor = 'all-scroll';
        } else if (this.dragTarget.startsWith('rotate_')) {
          this.canvas.style.cursor = 'pointer';
        } else {
          this.canvas.style.cursor = 'default';
        }
      } else {
        // 没有悬停在任何交互对象上，隐藏所有手柄
        this.canvas.style.cursor = 'default';
      }
    }
    this.invalidate();
    // 拖拽逻辑保持不变
    if (!this.isDragging || !this.dragTarget) return;

    console.log('dragging with target:', this.dragTarget);

    // 获取当前鼠标位置的世界坐标
    const normMouse = this.getNormalizedMousePosition(event);
    this.raycaster.setFromCamera(normMouse, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const worldMouse = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, worldMouse);

    let changeHorizontal = null;
    let changeVertical = null;

    if (this.dragTarget.startsWith('rotate_')) {
      const centerPoint = new THREE.Vector3(this.xPos, this.yPos, 0);
      const currentVector = new THREE.Vector3().subVectors(worldMouse, centerPoint);
      const currentAngle = Math.atan2(currentVector.y, currentVector.x);
      const deltaAngle = currentAngle - this.dragStartAngle;

      // --- 修正：直接发送旋转事件，不包装在drag中 ---
      this.onStateChange({
        type: 'rotate',
        orientation: this.orientation,
        target: this.dragTarget, // 'rotate_h' or 'rotate_v'
        deltaAngle: deltaAngle,
      });

      // 更新起始角度，为下一次mousemove做准备
      this.dragStartAngle = currentAngle;
      return; // 直接返回，不执行后续的drag逻辑
    } else if (this.dragTarget === 'crosshairs_horizontal_line' || this.dragTarget === 'center') {
      const totalDeltaWorldY = worldMouse.y - this.dragStartPosition.y;
      let target = '';
      let type = 'line';
      let sliceCountForY, startPosition, currentPosition;

      if (this.orientation === 'axial') {
        target = 'coronal';
        sliceCountForY = this.volume.metaData.height;
        startPosition = this.dragStartViewState.coronalPosition;
        currentPosition = this.viewState.coronalPosition;
      } else {
        // coronal or sagittal
        target = 'axial';
        sliceCountForY = this.volume.metaData.depth;
        startPosition = this.dragStartViewState.axialPosition;
        currentPosition = this.viewState.axialPosition;
      }

      // 修正：反算时要考虑平面缩放
      const positionChange = (-totalDeltaWorldY / this.slicePlane.scale.y) * (sliceCountForY - 1);
      const newPosition = startPosition + positionChange;
      const delta = newPosition - currentPosition;
      changeHorizontal = { target, type, delta };
    }
    if (this.dragTarget === 'crosshairs_vertical_line' || this.dragTarget === 'center') {
      const totalDeltaWorldX = worldMouse.x - this.dragStartPosition.x;
      let target = '';
      let type = 'line';
      let sliceCountForX, startPosition, currentPosition;

      if (this.orientation === 'axial' || this.orientation === 'coronal') {
        target = 'sagittal';
        sliceCountForX = this.volume.metaData.width;
        startPosition = this.dragStartViewState.sagittalPosition;
        currentPosition = this.viewState.sagittalPosition;
      } else {
        // sagittal
        target = 'coronal';
        sliceCountForX = this.volume.metaData.height;
        startPosition = this.dragStartViewState.coronalPosition;
        currentPosition = this.viewState.coronalPosition;
      }
      // 修正：反算时要考虑平面缩放
      const positionChange = (totalDeltaWorldX / this.slicePlane.scale.x) * (sliceCountForX - 1);
      const newPosition = startPosition + positionChange;
      const delta = newPosition - currentPosition;
      changeVertical = { target, type, delta };
    }
    if (this.dragTarget === 'slab_horizontal_handle') {
      let target = '';
      const type = 'handle';
      let currentThickness, sliceCount;
      if (this.orientation === 'axial') {
        target = 'coronal';
        sliceCount = this.volume.metaData.height;
        currentThickness = this.viewState.coronalThickness;
      } else {
        target = 'axial';
        sliceCount = this.volume.metaData.depth;
        currentThickness = this.viewState.axialThickness;
      }
      const newThickness = (Math.abs(worldMouse.y - this.yPos) / this.slicePlane.scale.y) * (sliceCount - 1) * 2;
      const delta = newThickness - currentThickness;
      changeHorizontal = { target, type, delta };
    } else if (this.dragTarget === 'slab_vertical_handle') {
      let target = '';
      const type = 'handle';
      let currentThickness, sliceCount;

      if (this.orientation === 'axial' || this.orientation === 'coronal') {
        target = 'sagittal';
        sliceCount = this.volume.metaData.width;
        currentThickness = this.viewState.sagittalThickness;
      } else {
        target = 'coronal';
        sliceCount = this.volume.metaData.height;
        currentThickness = this.viewState.coronalThickness;
      }
      const newThickness = (Math.abs(worldMouse.x - this.xPos) / this.slicePlane.scale.x) * (sliceCount - 1) * 2;
      const delta = newThickness - currentThickness;
      changeVertical = { target, type, delta };
    }

    // 只有非旋转事件才通过drag方式发送
    if (changeHorizontal || changeVertical) {
      this.onStateChange({
        type: 'drag',
        changes: [changeHorizontal, changeVertical].filter(Boolean),
      });
    }
  }
  handleMouseUp() {
    this.isDragging = false;
    this.isUIDragging = false;
    this.dragTarget = null;
  }
  invalidate() {
    this.isDirty = true;
    this._requestRender();
  }
  _requestRender() {
    if (!this.renderRequested) {
      this.renderRequested = true;
      requestAnimationFrame(() => this._performRender());
    }
  }
  _performRender() {
    this.renderRequested = false; // 允许下一帧的渲染请求

    if (this.isResizing) {
      this.renderer.render(this.scene, this.camera);
      this._requestRender(); // 在resizing期间，持续请求下一帧
      return;
    }

    const now = performance.now();
    // 计算距离上次渲染的时间间隔
    const elapsed = now - this.lastRenderTime;

    // 只有当场景是"脏"的，并且距离上次渲染的时间间隔已足够长，才执行绘制
    if (this.isDirty && elapsed >= this.interval) {
      // 校准时间，防止长时间卡顿后连续渲染
      this.lastRenderTime = now - (elapsed % this.interval);

      this.renderer.render(this.scene, this.camera);
      this.isDirty = false;
    }
    // 如果因为时间未到而跳过了本次渲染，但场景仍然是"脏"的，
    // 我们需要再次请求下一帧，以确保它最终会被画出来。
    if (this.isDirty) {
      this._requestRender();
    }
  }
}

export default GpuRenderer;
