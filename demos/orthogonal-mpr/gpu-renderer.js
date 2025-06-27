import * as THREE from 'three';

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
    vec3 texCoord = vec3(v_texCoord.x, 1.0 - v_texCoord.y, slice_coord);

    float intensity = texture(u_texture, texCoord).r;
    out_FragColor = vec4(vec3(applyWindow(intensity)), 1.0);
  }
`;

class GpuRenderer {
  constructor(container) {
    this.volume = null;
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width / height;
    this.camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 0.5, -0.5, 0.1, 1);
    this.camera.position.z = 1;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas });
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
  }
  setVolume(seriesDicomData) {
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

    const texture = new THREE.Data3DTexture(floatVolumeData, width, height, depth);
    texture.type = THREE.FloatType;
    texture.format = THREE.RedFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    // 设置纹理的解包对齐方式，确保纹理数据正确
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    this.slicePlane.material.uniforms.u_texture.value = texture;
    this.slicePlane.material.uniforms.u_numSlices.value = depth;
    this.slicePlane.material.uniforms.u_windowWidth.value = windowWidth;
    this.slicePlane.material.uniforms.u_windowCenter.value = windowCenter;
    this.slicePlane.material.uniforms.u_rescaleSlope.value = rescaleSlope;
    this.slicePlane.material.uniforms.u_rescaleIntercept.value = rescaleIntercept;
  }
  render(viewState) {
    const { sliceIndex, windowCenter, windowWidth } = viewState;
    this.slicePlane.material.uniforms.u_sliceIndex.value = sliceIndex;
    this.slicePlane.material.uniforms.u_windowCenter.value = windowCenter;
    this.slicePlane.material.uniforms.u_windowWidth.value = windowWidth;

    this.renderer.render(this.scene, this.camera);
  }
}

export default GpuRenderer;
