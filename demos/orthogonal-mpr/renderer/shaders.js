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
  uniform float u_sliceCount;
  uniform float u_slabThickness;
  uniform vec3 u_volume_size;
  uniform int u_slabMode; // 0: MaxIP, 1: MinIP, 2: AvgIP

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
    float slice_coord = (u_sliceIndex + 0.5) / u_sliceCount;

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
      float minValue = 99999.0;
      float sumValue = 0.0;
      int sampleCount = 0;
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
