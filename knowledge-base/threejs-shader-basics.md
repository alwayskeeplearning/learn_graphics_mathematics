# 知识点总结：Three.js着色器(Shader)与ShaderMaterial入门

要真正释放GPU的力量，就必须学会使用自定义的着色器。本文档旨在阐明GLSL的基础语法，以及Three.js中连接JS世界与GLSL世界的桥梁——`THREE.ShaderMaterial`的工作原理。

## 1. GLSL (OpenGL Shading Language) 基础

GLSL是一种在GPU上运行的、类似C语言的编程语言。一个渲染程序通常由两个核心部分组成：

### a. 顶点着色器 (Vertex Shader)

- **核心使命**: 计算模型中**每一个顶点**在屏幕上的最终位置。
- **关键语法元素**:

  - `in`: **输入**变量，从Geometry中传入的数据。
    - `vec3 position`: 顶点的原始坐标（Three.js自动提供）。
    - `vec2 uv`: 顶点的纹理坐标，用于贴图（Three.js自动提供）。
  - `uniform`: **全局**变量，在一次绘制中保持不变，由JS传入。
    - `mat4 projectionMatrix`: 投影矩阵（Three.js自动提供）。
    - `mat4 modelViewMatrix`: 模型视图矩阵（Three.js自动提供）。
  - `out`: **输出**变量，将数据传递给片元着色器。通常用于传递UV坐标等。
  - `gl_Position`: **内置输出**，必须被赋值，代表顶点的最终裁剪空间坐标。

- **示例代码**:

  ```glsl
  // 将UV坐标传递给片元着色器
  out vec2 vUv;

  void main() {
    // 传递UV
    vUv = uv;
    // 固定公式，计算顶点最终位置
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  ```

### b. 片元着色器 (Fragment Shader)

- **核心使命**: 计算模型覆盖的**每一个像素**最终应该是什么颜色。
- **关键语法元素**:

  - `in`: **输入**变量，从顶点着色器传来的、经过GPU**自动插值**的数据。
    - `vec2 vUv`: 接收到的、精确到每个像素的UV坐标。
  - `uniform`: **全局**变量，与顶点着色器共享，由JS传入。例如我们自己定义的`isampler2D u_texture`。
  - `out`: **输出**变量 (GLSL 3.00+)，声明一个`vec4`变量用于存放最终颜色(R,G,B,A)。
  - `texture(sampler, uv)`: 内置函数，从纹理采样器(sampler)的指定uv坐标处提取颜色/数据值。

- **示例代码**:

  ```glsl
  // 接收插值后的UV
  in vec2 vUv;
  // 声明颜色输出
  out vec4 out_FragColor;

  // 接收我们自己的uniforms
  uniform isampler2D u_texture;
  uniform float u_windowCenter;

  void main() {
    // 1. 从纹理采样，获取原始数据
    float value = float(texture(u_texture, vUv).r);
    // 2. 进行数学计算
    float finalGray = ... ; // (value - WC) / WW ...
    // 3. 将最终颜色赋值给输出变量
    out_FragColor = vec4(finalGray, finalGray, finalGray, 1.0);
  }
  ```

---

## 2. `THREE.ShaderMaterial()`: 连接的桥梁

`ShaderMaterial`允许我们用自定义的GLSL代码完全替代Three.js的内置光照和渲染逻辑。它是连接JavaScript与GLSL的桥梁。

`new THREE.ShaderMaterial({ ... });`

这个构造函数的核心属性包括：

- **`glslVersion: THREE.GLSL3`**: **指定协议**。明确告知Three.js使用GLSL 3.00规范来编译我们的着色器。这是使用现代特性的推荐做法。
- **`vertexShader: '...'`**: **提供顶点处理蓝图**。将你的顶点着色器代码字符串赋值给它。
- **`fragmentShader: '...'`**: **提供像素上色蓝图**。将你的片元着色器代码字符串赋值给它。
- **`uniforms: { ... }`**: **建立数据传输管道**。这是连接的核心，一个JS对象，其`key`对应GLSL中的`uniform`变量名。

### `uniforms`的工作机制

`uniforms`对象是实现动态交互的关键。

- **结构**:
  ```javascript
  uniforms: {
    // key: GLSL中的uniform变量名
    u_windowCenter: {
      // value: 对应的JS值
      value: 40.0
    },
    u_texture: {
      value: myTextureObject
    }
  }
  ```
- **工作流程**:
  1.  **初始化**: 创建`ShaderMaterial`时，Three.js会根据`uniforms`对象在GPU上创建对应的变量，并传入初始的`value`。
  2.  **动态更新**: 当我们在JavaScript代码中修改`material.uniforms.u_windowCenter.value = 50.0;`时，这个新值会在下一帧渲染前被自动、高效地同步到GPU。

这个机制使得我们可以在JS中用极小的开销（修改一个对象属性）来控制GPU上大规模的并行计算（整个画面的重新渲染），从而实现丝滑的实时交互。
