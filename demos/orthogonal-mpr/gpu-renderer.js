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
    float slice_coord;
    // For 3D Textures, the slice index is used to form the 3rd texture coordinate
    // We add 0.5 to sample the center of the voxel
    slice_coord = (u_sliceIndex + 0.5) / u_numSlices;

    // Boundary check: if the slice is outside the volume, render black
    if (slice_coord < 0.0 || slice_coord > 1.0) {
      out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    #if defined(CORONAL_VIEW)
      // 冠状位视图 XZ 平面 slice_coord 为 y 轴 翻转Y为1-v_texCoord.y 所以是 v_texCoord.x, slice_coord, 1.0 - v_texCoord.y
      vec3 texCoord = vec3(v_texCoord.x, slice_coord, 1.0 - v_texCoord.y);
      //                    X            Y               Z
      //                    .x           s              .y
    #elif defined(SAGITTAL_VIEW)
      // 矢状位视图 YZ 平面 slice_coord 为 x 轴 翻转Y为1-v_texCoord.y 所以是 slice_coord, v_texCoord.x, 1.0 - v_texCoord.y
      vec3 texCoord = vec3(slice_coord, v_texCoord.x, 1.0 - v_texCoord.y);
      //                    X            Y               Z
      //                    s            .x             .y
    #else
      // 轴状位视图 XY 平面 slice_coord 为 z 轴 翻转Y为1-v_texCoord.y 所以是 v_texCoord.x, 1.0 - v_texCoord.y, slice_coord
      vec3 texCoord = vec3(v_texCoord.x, 1.0 - v_texCoord.y, slice_coord);
      //                    X            Y               Z
      //                    .x           .y              s
    #endif

    float intensity = texture(u_texture, texCoord).r;
    out_FragColor = vec4(vec3(applyWindow(intensity)), 1.0);
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
    };

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
    const { axialPosition, coronalPosition, sagittalPosition } = viewState;
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
        xPos = sagittalPosition / (width - 1) - 0.5;
        yPos = 0.5 - coronalPosition / (height - 1);
        break;
      case 'coronal':
        uniforms.u_sliceIndex.value = coronalPosition;
        uniforms.u_numSlices.value = height;
        xPos = sagittalPosition / (width - 1) - 0.5;
        yPos = 0.5 - axialPosition / (depth - 1);
        break;
      case 'sagittal':
        uniforms.u_sliceIndex.value = sagittalPosition;
        uniforms.u_numSlices.value = width;
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

    this.renderer.render(this.scene, this.camera);
  }
  setupCrosshairs() {
    const { width, height } = this.container.getBoundingClientRect();
    // .axial-label { color: #00ffff; }   // 青色 - 轴状位
    // .coronal-label { color: #ff00ff; } // 品红 - 冠状位
    // .sagittal-label { color: #ffff00; }// 黄色 - 矢状位

    let horizontalColor, verticalColor;

    if (this.orientation === 'axial') {
      // 水平线代表冠状位(X), 垂直线代表矢状位(Y)
      horizontalColor = 0xff00ff; // Coronal
      verticalColor = 0xffff00; // Sagittal
    } else if (this.orientation === 'coronal') {
      // 水平线代表轴状位(X), 垂直线代表矢状位(Z)
      horizontalColor = 0x00ffff; // Axial
      verticalColor = 0xffff00; // Sagittal
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
      ...lineOptions,
      linewidth: 8, // A much larger width for easy clicking
      opacity: 0.2, // Make it invisible
      transparent: true,
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
      // 将鼠标位置转换为归一化设备坐标（NDC），范围为[-1, 1]
      mouse.x = ((event.clientX - canvasLeft) / canvasWidth) * 2 - 1;
      mouse.y = -((event.clientY - canvasTop) / canvasHeight) * 2 + 1;

      this.raycaster.setFromCamera(mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.hitboxGroup.children, true);

      if (intersects.length > 0) {
        this.dragTarget = intersects[0].object.userData.type;

        if (this.dragTarget === 'horizontal') {
          this.canvas.style.cursor = 'row-resize';
        } else if (this.dragTarget === 'vertical') {
          this.canvas.style.cursor = 'col-resize';
        } else if (this.dragTarget === 'center') {
          this.canvas.style.cursor = 'all-scroll';
        } else {
          this.canvas.style.cursor = 'default';
        }
      } else {
        this.canvas.style.cursor = 'default';
      }
    }
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
        // sagittal
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
