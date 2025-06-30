import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const SLICE_VERTEX_SHADER = `
varying vec2 v_texCoord;
  void main() {
    v_texCoord = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SLICE_FRAGMENT_SHADER = `
  precision highp float;
  precision highp sampler3D;

  uniform float u_windowWidth;
  uniform float u_windowCenter;
  uniform float u_rescaleSlope;
  uniform float u_rescaleIntercept;
  uniform highp sampler3D u_texture;
  uniform float u_sliceIndex;
  uniform float u_numSlices;
  uniform float u_slabThickness;
  uniform vec3 u_volume_size;

  varying vec2 v_texCoord;

  out vec4 out_FragColor;

  float applyWindow(float intensity) {
    intensity = intensity * u_rescaleSlope + u_rescaleIntercept;
    float lowerBound = u_windowCenter - u_windowWidth / 2.0;
    float upperBound = u_windowCenter + u_windowWidth / 2.0;
    float normalizedValue = (intensity - lowerBound) / u_windowWidth;
    normalizedValue = clamp(normalizedValue, 0.0, 1.0);
    return normalizedValue;
  }

  void main() {
    float slice_coord = (u_sliceIndex + 0.5) / u_numSlices;

    float rawValue;

    if (u_slabThickness < 1.0) {
      
      if (slice_coord < 0.0 || slice_coord > 1.0) {
        out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      vec3 texCoord;
      #if defined(CORONAL_VIEW)
        // 冠状位视图 XZ 平面 slice_coord 为 y 轴 翻转Y为1-v_texCoord.y 所以是 v_texCoord.x, slice_coord, 1.0 - v_texCoord.y
          texCoord = vec3(v_texCoord.x, slice_coord, 1.0 - v_texCoord.y);
        //                    X            Y               Z
        //                    .x           s              .y
      #elif defined(SAGITTAL_VIEW)
        // 矢状位视图 YZ 平面 slice_coord 为 x 轴 翻转Y为1-v_texCoord.y 所以是 slice_coord, v_texCoord.x, 1.0 - v_texCoord.y
          texCoord = vec3(slice_coord, v_texCoord.x, 1.0 - v_texCoord.y);
        //                    X            Y               Z
        //                    s            .x             .y
      #else
        // 轴状位视图 XY 平面 slice_coord 为 z 轴 翻转Y为1-v_texCoord.y 所以是 v_texCoord.x, 1.0 - v_texCoord.y, slice_coord
          texCoord = vec3(v_texCoord.x, 1.0 - v_texCoord.y, slice_coord);
        //                    X            Y               Z
        //                    .x           .y              s
      #endif
      rawValue = texture(u_texture, texCoord).r;
    } else {
      float maxValue = -99999.0;
      int thickness = int(u_slabThickness) / 2;
      
      for (int i = -thickness; i <= thickness; i++) {
        vec3 sample_coord;
        float current_slice_offset = 0.0;

        #if defined(CORONAL_VIEW)
          float step = 1.0 / u_volume_size.y;
          current_slice_offset = slice_coord + float(i) * step;
          sample_coord = vec3(v_texCoord.x, current_slice_offset, 1.0 - v_texCoord.y);
        #elif defined(SAGITTAL_VIEW)
          float step = 1.0 / u_volume_size.x;
          current_slice_offset = slice_coord + float(i) * step;
          sample_coord = vec3(current_slice_offset, v_texCoord.x, 1.0 - v_texCoord.y);
        #else
          float step = 1.0 / u_volume_size.z;
          current_slice_offset = slice_coord + float(i) * step;
          sample_coord = vec3(v_texCoord.x, 1.0 - v_texCoord.y, current_slice_offset);
        #endif

        if (current_slice_offset >= 0.0 && current_slice_offset <= 1.0) {
          float sampledValue = texture(u_texture, sample_coord).r;
          maxValue = max(maxValue, sampledValue);
        }
      }
      rawValue = maxValue;
    }

    out_FragColor = vec4(vec3(applyWindow(rawValue)), 1.0);
  }
`;

class GpuRenderer {
  constructor(container, orientation = 'axial', onStateChange = () => {}) {
    this.volume = null;
    this.container = container;
    this.orientation = orientation;
    this.onStateChange = onStateChange;

    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width / height;
    this.camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 0.5, -0.5, 0.1, 1);
    this.camera.position.z = 1;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, preserveDrawingBuffer: true });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 1);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: SLICE_VERTEX_SHADER,
      fragmentShader: SLICE_FRAGMENT_SHADER,
      uniforms: {
        u_texture: { value: null },
        u_sliceIndex: { value: 0 },
        u_numSlices: { value: 0 },
        u_windowWidth: { value: 0 },
        u_windowCenter: { value: 0 },
        u_rescaleSlope: { value: 1.0 },
        u_rescaleIntercept: { value: 0.0 },
        u_slabThickness: { value: 0.0 },
        u_volume_size: { value: new THREE.Vector3(0, 0, 0) },
      },
      glslVersion: THREE.GLSL3,
    });
    this.slicePlane = new THREE.Mesh(geometry, material);
    this.scene.add(this.slicePlane);

    this.crosshairsGroup = new THREE.Group();
    this.scene.add(this.crosshairsGroup);
    this.hitboxGroup = new THREE.Group();
    this.scene.add(this.hitboxGroup);

    this.lines = {
      visual: {},
      hitbox: {},
      slab: {},
    };
    this.handles = {};

    this.horizontalLineMaterial = null;
    this.verticalLineMaterial = null;
    this.hitboxHMaterial = null;
    this.hitboxVMaterial = null;

    this.raycaster = new THREE.Raycaster();
    // No threshold needed for Line2, as it's a Mesh. We use a hitbox instead.

    this.isDragging = false;
    this.dragTarget = null;
    this.lastMousePosition = { x: 0, y: 0 };

    this.setupCrosshairs();
    this.setupThicknessControls();
    this.setupDragHandlers();
  }
  dispose() {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.camera.left = -aspect / 2;
    this.camera.right = aspect / 2;
    this.camera.top = 0.5;
    this.camera.bottom = -0.5;
    this.camera.updateProjectionMatrix();
    if (this.horizontalLineMaterial && this.verticalLineMaterial) {
      this.horizontalLineMaterial.resolution.set(width, height);
      this.verticalLineMaterial.resolution.set(width, height);
      this.hitboxHMaterial.resolution.set(width, height);
      this.hitboxVMaterial.resolution.set(width, height);

      // --- 新增：更新所有虚线材质的分辨率 ---
      Object.values(this.lines.slab).forEach(line => {
        if (line.material) {
          line.material.resolution.set(width, height);
        }
      });
    }
  }
  setVolume(seriesDicomData, texture3D) {
    this.volume = seriesDicomData;
    const { data, metaData } = this.volume;
    const { width, height, depth, windowCenter, windowWidth, rescaleSlope, rescaleIntercept } = metaData;

    let TypedArray = data[0].pixelData.constructor;
    console.log(TypedArray);
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
      // 设置纹理的解包对齐方式，确保纹理数据正确
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
    }

    this.slicePlane.material.uniforms.u_texture.value = texture;
    this.slicePlane.material.uniforms.u_numSlices.value = depth;
    this.slicePlane.material.uniforms.u_windowWidth.value = windowWidth;
    this.slicePlane.material.uniforms.u_windowCenter.value = windowCenter;
    this.slicePlane.material.uniforms.u_rescaleSlope.value = rescaleSlope;
    this.slicePlane.material.uniforms.u_rescaleIntercept.value = rescaleIntercept;

    // --- 在此处填充 u_volume_size ---
    this.slicePlane.material.uniforms.u_volume_size.value.set(width, height, depth);

    // --- Physical Scaling Logic (Deactivated by default) ---
    // const { pixelSpacing, sliceThickness } = metaData;
    // const physicalWidth = width * pixelSpacing[0];
    // const physicalHeight = height * pixelSpacing[1];
    // const physicalDepth = depth * sliceThickness;

    // let aspectRatioX = 1;
    // let aspectRatioY = 1;

    // if (this.orientation === 'axial') {
    //   aspectRatioX = physicalWidth;
    //   aspectRatioY = physicalHeight;
    // } else if (this.orientation === 'coronal') {
    //   aspectRatioX = physicalWidth;
    //   aspectRatioY = physicalDepth;
    // } else if (this.orientation === 'sagittal') {
    //   aspectRatioX = physicalHeight;
    //   aspectRatioY = physicalDepth;
    // }

    // const maxDim = Math.max(aspectRatioX, aspectRatioY);
    // this.slicePlane.scale.x = aspectRatioX / maxDim;
    // this.slicePlane.scale.y = aspectRatioY / maxDim;
    this.slicePlane.scale.x = 1;
    this.slicePlane.scale.y = 1;
    // --- End of Physical Scaling Logic ---

    if (this.orientation === 'coronal') {
      this.slicePlane.material.defines.CORONAL_VIEW = true;
    } else if (this.orientation === 'sagittal') {
      this.slicePlane.material.defines.SAGITTAL_VIEW = true;
    } else {
      this.slicePlane.material.defines.AXIAL_VIEW = true;
    }

    return texture;
  }
  render(viewState) {
    if (!this.volume) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const { windowCenter, windowWidth } = viewState;
    const { width, height, depth } = this.volume.metaData;
    const { axialPosition, coronalPosition, sagittalPosition, axialThickness, coronalThickness, sagittalThickness } = viewState;
    const uniforms = this.slicePlane.material.uniforms;

    uniforms.u_windowCenter.value = windowCenter;
    uniforms.u_windowWidth.value = windowWidth;

    const { left, right, top, bottom } = this.camera;
    const gap = 0.05;
    const zOffset = 0.01;

    let xPos = 0;
    let yPos = 0;

    switch (this.orientation) {
      case 'axial':
        uniforms.u_sliceIndex.value = axialPosition;
        uniforms.u_numSlices.value = depth;
        uniforms.u_slabThickness.value = axialThickness || 0.0;
        xPos = sagittalPosition / (width - 1) - 0.5;
        yPos = 0.5 - coronalPosition / (height - 1);
        break;
      case 'coronal':
        uniforms.u_sliceIndex.value = coronalPosition;
        uniforms.u_numSlices.value = height;
        uniforms.u_slabThickness.value = coronalThickness || 0.0;
        xPos = sagittalPosition / (width - 1) - 0.5;
        yPos = 0.5 - axialPosition / (depth - 1);
        break;
      case 'sagittal':
        uniforms.u_sliceIndex.value = sagittalPosition;
        uniforms.u_numSlices.value = width;
        uniforms.u_slabThickness.value = sagittalThickness || 0.0;
        xPos = coronalPosition / (height - 1) - 0.5;
        yPos = 0.5 - axialPosition / (depth - 1);
        break;
    }

    // Define points for the lines based on the intersection
    const leftHPoints = [left, yPos, zOffset, xPos - gap, yPos, zOffset];
    const rightHPoints = [xPos + gap, yPos, zOffset, right, yPos, zOffset];
    const bottomVPoints = [xPos, bottom, zOffset, xPos, yPos - gap, zOffset];
    const topVPoints = [xPos, yPos + gap, zOffset, xPos, top, zOffset];

    // Update geometries of all lines
    this.lines.visual.left?.geometry.setPositions(leftHPoints);
    this.lines.visual.right?.geometry.setPositions(rightHPoints);
    this.lines.visual.bottom?.geometry.setPositions(bottomVPoints);
    this.lines.visual.top?.geometry.setPositions(topVPoints);

    this.lines.hitbox.left?.geometry.setPositions(leftHPoints);
    this.lines.hitbox.right?.geometry.setPositions(rightHPoints);
    this.lines.hitbox.bottom?.geometry.setPositions(bottomVPoints);
    this.lines.hitbox.top?.geometry.setPositions(topVPoints);

    this.lines.hitbox.center?.position.set(xPos, yPos, zOffset);

    // --- 核心修正：为水平和垂直方向分别获取厚度值 ---
    let verticalSlabThickness = 0.0;
    let horizontalSlabThickness = 0.0;

    // 根据当前视图，决定水平线/垂直线分别对应哪个方向的厚度
    if (this.orientation === 'axial') {
      verticalSlabThickness = viewState.sagittalThickness || 0.0; // 垂直线(矢状位)代表Y轴，
      horizontalSlabThickness = viewState.coronalThickness || 0.0; // 水平线(冠状位)代表X轴，
    } else if (this.orientation === 'coronal') {
      verticalSlabThickness = viewState.sagittalThickness || 0.0; // 垂直线(矢状位)代表Z轴，
      horizontalSlabThickness = viewState.axialThickness || 0.0; // 水平线(轴状位)代表X轴，
    } else {
      // sagittal
      verticalSlabThickness = viewState.coronalThickness || 0.0; // 垂直线(冠状位)代表Z轴
      horizontalSlabThickness = viewState.axialThickness || 0.0; // 水平线(轴状位)代表Y轴
    }

    const hasVerticalSlab = verticalSlabThickness > 0.0;
    const hasHorizontalSlab = horizontalSlabThickness > 0.0;

    // --- 更新可见性 ---
    this.lines.slab.h_top.visible = this.lines.slab.h_bottom.visible = hasHorizontalSlab;
    this.lines.slab.v_left.visible = this.lines.slab.v_right.visible = hasVerticalSlab;
    this.lines.slab.h_top_hitbox.visible = this.lines.slab.h_bottom_hitbox.visible = hasHorizontalSlab;
    this.lines.slab.v_left_hitbox.visible = this.lines.slab.v_right_hitbox.visible = hasVerticalSlab;

    // --- 更新位置 ---
    if (hasHorizontalSlab || hasVerticalSlab) {
      let verticalOffset = 0;
      let horizontalOffset = 0;

      // (偏移量计算逻辑不变)
      if (this.orientation === 'axial') {
        verticalOffset = verticalSlabThickness / 2 / width;
        horizontalOffset = horizontalSlabThickness / 2 / height;
      } else if (this.orientation === 'coronal') {
        verticalOffset = verticalSlabThickness / 2 / width; // 注意这里的对应关系
        horizontalOffset = horizontalSlabThickness / 2 / depth;
      } else {
        // sagittal
        verticalOffset = verticalSlabThickness / 2 / height;
        horizontalOffset = horizontalSlabThickness / 2 / depth;
      }

      // 水平方向的贯穿线 (由 horizontalOffset 控制)
      const hTop = yPos + horizontalOffset;
      const hBottom = yPos - horizontalOffset;
      this.lines.slab.h_top.geometry.setPositions([left, hTop, zOffset, right, hTop, zOffset]);
      this.lines.slab.h_bottom.geometry.setPositions([left, hBottom, zOffset, right, hBottom, zOffset]);

      // 同步更新水平方向的hitbox
      this.lines.slab.h_top_hitbox.geometry.setPositions([left, hTop, zOffset, right, hTop, zOffset]);
      this.lines.slab.h_bottom_hitbox.geometry.setPositions([left, hBottom, zOffset, right, hBottom, zOffset]);

      // 垂直方向的贯穿线 (由 verticalOffset 控制)
      const vLeft = xPos - verticalOffset;
      const vRight = xPos + verticalOffset;
      this.lines.slab.v_left.geometry.setPositions([vLeft, bottom, zOffset, vLeft, top, zOffset]);
      this.lines.slab.v_right.geometry.setPositions([vRight, top, zOffset, vRight, bottom, zOffset]);

      // 同步更新垂直方向的hitbox
      this.lines.slab.v_left_hitbox.geometry.setPositions([vLeft, bottom, zOffset, vLeft, top, zOffset]);
      this.lines.slab.v_right_hitbox.geometry.setPositions([vRight, top, zOffset, vRight, bottom, zOffset]);

      this.lines.slab.h_top.computeLineDistances();
      this.lines.slab.h_bottom.computeLineDistances();
      this.lines.slab.v_left.computeLineDistances();
      this.lines.slab.v_right.computeLineDistances();

      // 手柄定位
      const handlePosOffset = 0.2; // 调整手柄位置
      this.handles.h_top_left.position.set(xPos - handlePosOffset, hTop, zOffset + 0.01);
      this.handles.h_top_right.position.set(xPos + handlePosOffset, hTop, zOffset + 0.01);
      this.handles.h_bottom_left.position.set(xPos - handlePosOffset, hBottom, zOffset + 0.01);
      this.handles.h_bottom_right.position.set(xPos + handlePosOffset, hBottom, zOffset + 0.01);
      this.handles.v_left_top.position.set(vLeft, yPos + handlePosOffset, zOffset + 0.01);
      this.handles.v_right_top.position.set(vRight, yPos + handlePosOffset, zOffset + 0.01);
      this.handles.v_left_bottom.position.set(vLeft, yPos - handlePosOffset, zOffset + 0.01);
      this.handles.v_right_bottom.position.set(vRight, yPos - handlePosOffset, zOffset + 0.01);
      this.handles.h_top_left.visible = hasHorizontalSlab;
      this.handles.h_top_right.visible = hasHorizontalSlab;
      this.handles.h_bottom_left.visible = hasHorizontalSlab;
      this.handles.h_bottom_right.visible = hasHorizontalSlab;
      this.handles.v_left_top.visible = hasVerticalSlab;
      this.handles.v_right_top.visible = hasVerticalSlab;
      this.handles.v_left_bottom.visible = hasVerticalSlab;
      this.handles.v_right_bottom.visible = hasVerticalSlab;
    }
    this.renderer.render(this.scene, this.camera);
  }
  setupCrosshairs() {
    const { width, height } = this.container.getBoundingClientRect();
    // .axial-label { color: #00ffff; }   // 青色 - 轴状位
    // .coronal-label { color: #ff00ff; } // 品红 - 冠状位
    // .sagittal-label { color: #00ff00; }// 黄色 - 矢状位

    let horizontalColor, verticalColor;

    if (this.orientation === 'axial') {
      // 水平线代表冠状位(X), 垂直线代表矢状位(Y)
      horizontalColor = 0xff00ff; // Coronal
      verticalColor = 0x00ff00; // Sagittal
    } else if (this.orientation === 'coronal') {
      // 水平线代表轴状位(X), 垂直线代表矢状位(Z)
      horizontalColor = 0x00ffff; // Axial
      verticalColor = 0x00ff00; // Sagittal
    } else if (this.orientation === 'sagittal') {
      // 水平线代表轴状位(Y), 垂直线代表冠状位(Z)
      horizontalColor = 0x00ffff; // Axial
      verticalColor = 0xff00ff; // Coronal
    }

    const lineOptions = {
      linewidth: 2,
      transparent: true,
      opacity: 0.7,
      // 设置线材质的分辨率，确保线在屏幕上显示正常
      resolution: new THREE.Vector2(width, height),
    };

    const hitboxLineOptions = {
      linewidth: 8, // 较宽的hitbox便于鼠标悬停检测
      transparent: true,
      opacity: 0.2, // 完全透明
      resolution: new THREE.Vector2(width, height),
    };

    this.horizontalLineMaterial = new LineMaterial({ ...lineOptions, color: horizontalColor });
    this.verticalLineMaterial = new LineMaterial({ ...lineOptions, color: verticalColor });
    this.hitboxHMaterial = new LineMaterial({ ...hitboxLineOptions, color: horizontalColor });
    this.hitboxVMaterial = new LineMaterial({ ...hitboxLineOptions, color: verticalColor });

    // Geometries will be initialized empty and updated in the render loop.
    const geoms = {
      vl: new LineGeometry(),
      vr: new LineGeometry(),
      vb: new LineGeometry(),
      vt: new LineGeometry(),
      hl: new LineGeometry(),
      hr: new LineGeometry(),
      hb: new LineGeometry(),
      ht: new LineGeometry(),
    };

    // --- Visible Lines ---
    this.lines.visual.left = new Line2(geoms.vl, this.horizontalLineMaterial);
    this.lines.visual.right = new Line2(geoms.vr, this.horizontalLineMaterial);
    this.lines.visual.bottom = new Line2(geoms.vb, this.verticalLineMaterial);
    this.lines.visual.top = new Line2(geoms.vt, this.verticalLineMaterial);
    this.crosshairsGroup.add(this.lines.visual.left, this.lines.visual.right, this.lines.visual.bottom, this.lines.visual.top);

    // --- Hitbox Lines ---
    this.lines.hitbox.left = new Line2(geoms.hl, this.hitboxHMaterial);
    this.lines.hitbox.left.userData.type = 'horizontal';
    this.lines.hitbox.right = new Line2(geoms.hr, this.hitboxHMaterial);
    this.lines.hitbox.right.userData.type = 'horizontal';
    this.lines.hitbox.bottom = new Line2(geoms.hb, this.hitboxVMaterial);
    this.lines.hitbox.bottom.userData.type = 'vertical';
    this.lines.hitbox.top = new Line2(geoms.ht, this.hitboxVMaterial);
    this.lines.hitbox.top.userData.type = 'vertical';
    this.hitboxGroup.add(this.lines.hitbox.left, this.lines.hitbox.right, this.lines.hitbox.bottom, this.lines.hitbox.top);

    // --- Center Point ---
    const centerGeo = new THREE.PlaneGeometry(0.1, 0.1);
    const centerMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    this.lines.hitbox.center = new THREE.Mesh(centerGeo, centerMat);
    this.lines.hitbox.center.userData.type = 'center';
    this.hitboxGroup.add(this.lines.hitbox.center);
  }
  setupThicknessControls() {
    const handleSize = 0.02;
    const handleGeometry = new THREE.PlaneGeometry(handleSize, handleSize);
    const { width, height } = this.container.getBoundingClientRect();

    const lineOptions = {
      linewidth: 1,
      dashed: true,
      dashSize: 0.01,
      gapSize: 0.01,
      resolution: new THREE.Vector2(width, height),
      transparent: true,
      opacity: 0.7,
    };

    const hitboxLineOptions = {
      linewidth: 8, // 较宽的hitbox便于鼠标悬停检测
      transparent: true,
      opacity: 0.2, // 完全透明
      resolution: new THREE.Vector2(width, height),
    };

    // --- 水平方向的控制器 ---
    const hLineMaterial = new LineMaterial({ ...lineOptions, color: this.horizontalLineMaterial.color });
    const hHandleMaterial = new THREE.MeshBasicMaterial({ color: this.horizontalLineMaterial.color, transparent: true, opacity: 0.7 });
    const hHitboxMaterial = new LineMaterial({ ...hitboxLineOptions, color: this.horizontalLineMaterial.color });

    // 上、下两条贯穿的虚线（可见）
    this.lines.slab.h_top = new Line2(new LineGeometry(), hLineMaterial);
    this.lines.slab.h_bottom = new Line2(new LineGeometry(), hLineMaterial.clone());

    // 上、下两条贯穿的虚线（hitbox）
    this.lines.slab.h_top_hitbox = new Line2(new LineGeometry(), hHitboxMaterial);
    this.lines.slab.h_bottom_hitbox = new Line2(new LineGeometry(), hHitboxMaterial.clone());
    this.lines.slab.h_top_hitbox.userData.type = 'slab_horizontal';
    this.lines.slab.h_bottom_hitbox.userData.type = 'slab_horizontal';

    // 水平方向的手柄
    this.handles.h_top_left = new THREE.Mesh(handleGeometry, hHandleMaterial);
    this.handles.h_top_right = new THREE.Mesh(handleGeometry, hHandleMaterial.clone());
    this.handles.h_bottom_left = new THREE.Mesh(handleGeometry, hHandleMaterial.clone());
    this.handles.h_bottom_right = new THREE.Mesh(handleGeometry, hHandleMaterial.clone());
    this.handles.h_top_left.name = 'handle_h_top';
    this.handles.h_top_right.name = 'handle_h_top';
    this.handles.h_bottom_left.name = 'handle_h_bottom';
    this.handles.h_bottom_right.name = 'handle_h_bottom';

    // --- 垂直方向的控制器 ---
    const vLineMaterial = new LineMaterial({ ...lineOptions, color: this.verticalLineMaterial.color });
    const vHandleMaterial = new THREE.MeshBasicMaterial({ color: this.verticalLineMaterial.color, transparent: true, opacity: 0.8 });
    const vHitboxMaterial = new LineMaterial({ ...hitboxLineOptions, color: this.verticalLineMaterial.color });

    // 左、右两条贯穿的虚线（可见）
    this.lines.slab.v_left = new Line2(new LineGeometry(), vLineMaterial);
    this.lines.slab.v_right = new Line2(new LineGeometry(), vLineMaterial.clone());

    // 左、右两条贯穿的虚线（hitbox）
    this.lines.slab.v_left_hitbox = new Line2(new LineGeometry(), vHitboxMaterial);
    this.lines.slab.v_right_hitbox = new Line2(new LineGeometry(), vHitboxMaterial.clone());
    this.lines.slab.v_left_hitbox.userData.type = 'slab_vertical';
    this.lines.slab.v_right_hitbox.userData.type = 'slab_vertical';

    // 垂直方向的手柄
    this.handles.v_left_top = new THREE.Mesh(handleGeometry, vHandleMaterial);
    this.handles.v_right_top = new THREE.Mesh(handleGeometry, vHandleMaterial.clone());
    this.handles.v_left_bottom = new THREE.Mesh(handleGeometry, vHandleMaterial.clone());
    this.handles.v_right_bottom = new THREE.Mesh(handleGeometry, vHandleMaterial.clone());
    this.handles.v_left_top.name = 'handle_v_left';
    this.handles.v_left_bottom.name = 'handle_v_left';
    this.handles.v_right_top.name = 'handle_v_right';
    this.handles.v_right_bottom.name = 'handle_v_right';

    // 将可见线条添加到场景中
    this.scene.add(this.lines.slab.h_top, this.lines.slab.h_bottom, this.lines.slab.v_left, this.lines.slab.v_right, this.handles.h_top, this.handles.h_bottom, this.handles.v_left, this.handles.v_right);

    // 将hitbox添加到hitboxGroup中
    this.hitboxGroup.add(this.lines.slab.h_top_hitbox, this.lines.slab.h_bottom_hitbox, this.lines.slab.v_left_hitbox, this.lines.slab.v_right_hitbox);

    // 默认全部隐藏
    Object.values(this.lines.slab).forEach(line => (line.visible = false));
    Object.values(this.handles).forEach(handle => (handle.visible = false));
  }
  setupDragHandlers() {
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);

    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
  }

  handleMouseDown(event) {
    if (event.button !== 0) return; // Only handle left-click

    const { width, height, left, top } = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    // 将鼠标位置转换为归一化设备坐标（NDC），范围为[-1, 1]
    mouse.x = ((event.clientX - left) / width) * 2 - 1;
    mouse.y = -((event.clientY - top) / height) * 2 + 1;

    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.hitboxGroup.children, true);

    if (intersects.length > 0) {
      this.isDragging = true;
      this.lastMousePosition = { x: event.clientX, y: event.clientY };

      document.addEventListener('mouseup', this.handleMouseUp, { once: true });

      event.preventDefault();
    }
  }

  handleMouseMove(event) {
    if (!this.isDragging) {
      const { width: canvasWidth, height: canvasHeight, left: canvasLeft, top: canvasTop } = this.canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - canvasLeft) / canvasWidth) * 2 - 1;
      mouse.y = -((event.clientY - canvasTop) / canvasHeight) * 2 + 1;

      this.raycaster.setFromCamera(mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.hitboxGroup.children, true);

      // --- 新增：手柄显示逻辑 ---
      // 首先隐藏所有手柄
      Object.values(this.handles).forEach(handle => (handle.visible = false));

      if (intersects.length > 0) {
        this.dragTarget = intersects[0].object.userData.type;
        console.log(this.dragTarget);

        // 根据悬停的对象类型，显示对应的手柄
        if (this.dragTarget === 'horizontal') {
          // 悬停在十字线的水平部分，显示水平方向的厚度手柄
          this.handles.h_top_left.visible = true;
          this.handles.h_top_right.visible = true;
          this.handles.h_bottom_left.visible = true;
          this.handles.h_bottom_right.visible = true;
          this.canvas.style.cursor = 'row-resize';
        } else if (this.dragTarget === 'vertical') {
          // 悬停在十字线的垂直部分，显示垂直方向的厚度手柄
          this.handles.v_left_top.visible = true;
          this.handles.v_right_top.visible = true;
          this.handles.v_left_bottom.visible = true;
          this.handles.v_right_bottom.visible = true;
          this.canvas.style.cursor = 'col-resize';
        } else if (this.dragTarget === 'slab_horizontal') {
          // 悬停在水平厚度辅助线，显示水平方向的厚度手柄
          this.handles.h_top_left.visible = true;
          this.handles.h_top_right.visible = true;
          this.handles.h_bottom_left.visible = true;
          this.handles.h_bottom_right.visible = true;
          this.canvas.style.cursor = 'row-resize';
          console.log('slab_horizontal');
        } else if (this.dragTarget === 'slab_vertical') {
          // 悬停在垂直厚度辅助线，显示垂直方向的厚度手柄
          this.handles.v_left_top.visible = true;
          this.handles.v_right_top.visible = true;
          this.handles.v_left_bottom.visible = true;
          this.handles.v_right_bottom.visible = true;
          this.canvas.style.cursor = 'col-resize';
        } else if (this.dragTarget === 'center') {
          // 悬停在中心点，显示所有手柄
          Object.values(this.handles).forEach(handle => (handle.visible = true));
          this.canvas.style.cursor = 'all-scroll';
        } else {
          this.canvas.style.cursor = 'default';
        }
      } else {
        // 没有悬停在任何交互对象上，隐藏所有手柄
        this.canvas.style.cursor = 'default';
      }
    }

    // 拖拽逻辑保持不变
    if (!this.isDragging || !this.dragTarget) return;

    const deltaX = event.clientX - this.lastMousePosition.x;
    const deltaY = event.clientY - this.lastMousePosition.y;
    this.lastMousePosition = { x: event.clientX, y: event.clientY };

    if (!this.volume) return;

    let changeHorizontal = null;
    let changeVertical = null;

    if (this.dragTarget === 'horizontal' || this.dragTarget === 'center') {
      let target = '';
      let delta = 0;
      if (this.orientation === 'axial') {
        target = 'coronal';
        delta = deltaY;
      } else {
        target = 'axial';
        delta = deltaY;
      }
      changeHorizontal = { target, delta };
    }

    if (this.dragTarget === 'vertical' || this.dragTarget === 'center') {
      let target = '';
      let delta = 0;
      if (this.orientation === 'axial' || this.orientation === 'coronal') {
        target = 'sagittal';
        delta = deltaX;
      } else {
        target = 'coronal';
        delta = deltaX;
      }
      changeVertical = { target, delta };
    }

    this.onStateChange({
      type: 'drag',
      changes: [changeHorizontal, changeVertical].filter(Boolean),
    });
  }

  handleMouseUp() {
    this.isDragging = false;
    this.dragTarget = null;
    document.removeEventListener('mousemove', this.handleMouseMove);
  }
}

export default GpuRenderer;
