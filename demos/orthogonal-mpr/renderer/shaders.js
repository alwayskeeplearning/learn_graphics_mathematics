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
  uniform float u_slabThickness;
  uniform vec3 u_textureSize;
  uniform int u_slabMode; // 0: MaxIP, 1: MinIP, 2: AvgIP

  // --- 新增：用于定义任意平面的Uniforms ---
  uniform vec3 u_plane_origin; // 平面中心点在纹理坐标系中的位置 [0, 1]
  uniform vec3 u_plane_xAxis;  // 平面X轴方向向量 (已乘以宽度比例)
  uniform vec3 u_plane_yAxis;  // 平面Y轴方向向量 (已乘以高度比例)
  uniform vec3 u_plane_normal; // 平面法向量 (用于MIP)
  
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
    // v_texCoord 是从模型顶点传入的UV坐标，范围从 (0,0) 到 (1,1).
    // 我们将它映射到 [-0.5, 0.5] 的范围，这样可以计算出相对于平面中心点的位移.
    vec3 displacement = (v_texCoord.x - 0.5) * u_plane_xAxis + (v_texCoord.y - 0.5) * u_plane_yAxis;
    
    // 最终的采样中心点坐标
    vec3 center_texCoord = u_plane_origin + displacement;

    float rawValue;

    if (u_slabThickness < 1.0) {
      // 检查纹理坐标是否在 [0, 1] 的有效范围内
      if (any(lessThan(center_texCoord, vec3(0.0))) || any(greaterThan(center_texCoord, vec3(1.0)))) {
        out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      rawValue = texture(u_texture, center_texCoord).r;
    } else {
      float maxValue = -99999.0;
      float minValue = 99999.0;
      float sumValue = 0.0;
      int sampleCount = 0;
      int thickness = int(u_slabThickness) / 2;
      
      // 沿着法线方向，计算一个体素单位的步进向量
      vec3 step_vec = u_plane_normal / u_textureSize;

      for (int i = -thickness; i <= thickness; i++) {
        vec3 sample_coord = center_texCoord + float(i) * step_vec;

        // 只对有效范围内的体素进行采样
        if (all(greaterThanEqual(sample_coord, vec3(0.0))) && all(lessThanEqual(sample_coord, vec3(1.0)))) {
          float sampledValue = texture(u_texture, sample_coord).r;
          maxValue = max(maxValue, sampledValue);
          minValue = min(minValue, sampledValue);
          sumValue += sampledValue;
          sampleCount++;
        }
      }

      if (sampleCount > 0) {
        if (u_slabMode == 1) { // MinIP
          rawValue = minValue;
        } else if (u_slabMode == 2) { // AvgIP
          rawValue = sumValue / float(sampleCount);
        } else { // MaxIP (默认)
          rawValue = maxValue;
        }
      } else {
        // 如果没有采样到任何点（例如，切片完全在体数据之外）
        rawValue = -99999.0; // 或者一个合适的默认值
      }
    }

    out_FragColor = vec4(vec3(applyWindow(rawValue)), 1.0);
  }
`;

export { SLICE_VERTEX_SHADER, SLICE_FRAGMENT_SHADER };
