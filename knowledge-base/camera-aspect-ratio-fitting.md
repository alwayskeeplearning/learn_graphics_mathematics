# 保持内容宽高比的相机自适应策略（Letterboxing/Pillarboxing）

## 1. 问题：窗口缩放导致内容变形或裁切

在进行 WebGL 或其他图形渲染时，一个核心挑战是如何处理渲染窗口（Viewport）与被渲染内容（Content）之间的宽高比不匹配问题。

例如，我们有一个宽高比为 1:1 的正方形图像，但用户浏览器窗口的宽高比可能是 16:9（宽屏）或 9:16（竖屏）。如果处理不当，会导致以下两种常见问题：

1.  **内容拉伸 (Stretch/Fill)**：强行将 1:1 的图像拉伸以填满 16:9 的窗口，导致图像严重变形，正方形变成长方形。
2.  **内容裁切 (Crop)**：保持图像 1:1 的比例，但由于窗口尺寸限制，图像的上下或左右部分被裁切掉，无法完整显示。

在专业应用（如医学影像、游戏、数据可视化）中，这两种情况通常都是不可接受的。我们需要一种能完整显示、且不破坏原始比例的方案。

## 2. 核心原则："适应"相机，而非"拉伸"内容

正确的解决方案是实现一种"适应（Fit）"策略。即调整相机的"取景范围"，使其刚好能完整地"包容"住我们的内容，同时保持相机自身的宽高比与窗口一致。多出来的空间则用背景色（通常是黑色）填充。

- 如果窗口比内容宽，就在内容左右两边留出黑边，这称为 **Pillarboxing**。
- 如果窗口比内容高，就在内容上下两边留出黑边，这称为 **Letterboxing**。

这个原则确保了内容本身（例如，Three.js 中的 `Mesh`）的 `scale` 保持不变，我们只调整相机这个"观察者"。

## 3. 算法详解与代码实例

该算法的核心是比较"窗口的宽高比" (`viewportAspect`) 和"内容的宽高比" (`contentAspect`)，以确定哪个维度（宽或高）是限制性维度，并以此为基准来计算正交相机的四个边界。

以下是我们项目中 `resize` 函数的最终实现。它完美地整合了两种情况的处理逻辑，并具备动态适应内容宽高比的能力，是该模式的最佳实践范例。

```javascript
// resize() 方法实现
const { width, height } = this.container.getBoundingClientRect();
this.renderer.setSize(width, height);
const viewportAspect = width / height;

// 动态计算内容的宽高比，不再硬编码
// 基础几何是1x1，所以宽高比就是其缩放值的比
const contentAspect = this.slicePlane.scale.x / this.slicePlane.scale.y;

if (viewportAspect > contentAspect) {
  // 情况1：窗口比内容更"宽" -> 以内容高度为基准，左右留黑 (Pillarboxing)
  //
  // 策略：让相机取景高度等于内容高度，然后根据窗口宽高比反推相机宽度。
  // 在我们的代码中，由于内容高度最终被归一化为 contentAspect，所以：
  this.camera.top = contentAspect / 2;
  this.camera.bottom = -contentAspect / 2;
  this.camera.left = (-contentAspect / 2) * viewportAspect;
  this.camera.right = (contentAspect / 2) * viewportAspect;
} else {
  // 情况2：窗口比内容更"高"或相等 -> 以内容宽度为基准，上下留黑 (Letterboxing)
  //
  // 策略：让相机取景宽度等于内容宽度，然后根据窗口宽高比反推相机高度。
  //
  // 推导过程:
  // 1. 锁定相机宽度: cameraWidth = contentAspect
  // 2. 求解相机高度: cameraHeight = cameraWidth / viewportAspect = contentAspect / viewportAspect
  // 3. 设置相机边界:
  this.camera.left = -contentAspect / 2;
  this.camera.right = contentAspect / 2;
  this.camera.top = contentAspect / (2 * viewportAspect);
  this.camera.bottom = -contentAspect / (2 * viewportAspect);
}

this.camera.updateProjectionMatrix();
```

> **教师解读**:
> 这段代码非常清晰地展示了两种核心逻辑：
>
> - **`else` 代码块 (窗口更高)**: 这里的逻辑是完全正确的。它以内容的宽度 `contentAspect` 为基准，然后通过 `contentAspect / (2 * viewportAspect)` 推导出了正确的高度，确保相机在任何情况下都保持与窗口一致的宽高比。
> - **`if` 代码块 (窗口更宽)**: 这里的逻辑是基于`else`块的逻辑推导出来的正确实现。它以内容的高度 `contentAspect / 2` 为基准，然后通过乘以 `viewportAspect` 来反推相机的宽度，保证了相机的宽高比始终与窗口一致。

## 4. 生活化类比：将照片放入相框

想象你有一张**固定宽度**为30厘米的照片 (`contentWidth = 30`)。

- **相框A (宽40cm, 高30cm)**:
  - `viewportAspect` ≈ 1.33, `contentAspect` 可能为 1 (如果照片是方的)。`viewportAspect > contentAspect`。
  - 照片的高度是限制因素。为了完整放入，照片上下顶满，左右会留出空隙。这对应**情况1**。
- **相框B (宽30cm, 高40cm)**:
  - `viewportAspect` = 0.75。`viewportAspect < contentAspect`。
  - 照片的宽度`30cm`是限制因素，它刚好填满相框的宽度。
  - 相框的高度`40cm`是根据它自己的宽高比和已固定的宽度计算出来的 (`高度 = 宽度 / aspect = 30 / 0.75 = 40`)。
  - 当你把照片放进去时，照片的上下方就会留出空隙。这对应**情况2**，我们代码中的复杂公式正是在计算这个"高出来的部分"的一半。

## 5. 结论与应用场景

此"相机适应"算法是任何需要保证内容显示完整性与保真度的图形应用的基石。它广泛应用于：

- **医学影像（DICOM）浏览器**：确保器官和病灶不因窗口变化而变形。
- **数据可视化**：保证图表的比例和读数准确。
- **2D/3D 游戏**：确保游戏世界的视野和布局在不同分辨率设备上保持一致体验。
- **在线图片/视频编辑器**：在编辑区域内完整显示素材，同时维持其原始比例。
