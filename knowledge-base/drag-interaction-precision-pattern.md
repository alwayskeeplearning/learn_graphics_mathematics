# 交互拖拽的精度控制设计模式

## 1. 问题背景：为何拖拽会"失准"？

在开发需要高精度拖拽的图形应用（如医学影像、CAD软件、游戏引擎编辑器）时，一个常见的问题是：当用户快速拖动鼠标时，被拖动的对象（如十字线、控制点）会与鼠标指针产生肉眼可见的累积偏差，导致操作不跟手、感觉迟钝，甚至定位错误。

### 错误的方法：增量计算

问题的根源在于一种直观但错误的实现方式——**增量计算**。

```javascript
// 伪代码：错误的增量计算模式
let lastMousePosition = { x: 0, y: 0 };

function onMouseDown(event) {
  lastMousePosition = { x: event.clientX, y: event.clientY };
}

function onMouseMove(event) {
  // 计算两帧之间的鼠标位移（增量）
  const deltaX = event.clientX - lastMousePosition.x;
  const deltaY = event.clientY - lastMousePosition.y;

  // 将增量应用到对象当前位置
  object.position.x += convertToWorld(deltaX);
  object.position.y += convertToWorld(deltaY);

  // 更新"上一次"位置，为下一次计算做准备
  lastMousePosition = { x: event.clientX, y: event.clientY };
}
```

这种方法的致命缺陷在于它**依赖于上一次的状态** (`lastMousePosition`)。浏览器为了性能，并不能保证响应每一次像素的鼠标移动，尤其是在高频率移动或CPU繁忙时，`mousemove` 事件会被"抽帧"，即两次事件之间鼠标可能已经移动了很长一段距离。如果一个事件丢失，`lastMousePosition` 就没有被更新，下一次计算出的 `delta` 虽然是正确的，但它被加到了一个已经"过时"的 `object.position` 上，偏差就此产生且会不断累积。

## 2. 核心原则：从"增量"到"绝对位移"

解决此问题的核心思想是，将计算模式从**依赖上一次状态的增量累加**，彻底转变为**只依赖初始状态的绝对位移计算**。

**新位置 = 拖拽起始位置 + (当前鼠标位置 - 拖拽起始鼠标位置)**

这个公式确保了无论中间丢失多少次 `mousemove` 事件，下一次计算出的新位置总是正确的，因为它只与固定不变的"起始点"有关，从而彻底消除了累积误差。

## 3. 实施步骤

### 步骤 1: `mousedown` — 记录初始状态

在拖拽开始时，必须记录下所有未来计算需要用到的"基准值"。

```javascript
let dragStartPosition; // 鼠标起始位置（建议用世界坐标）
let dragStartObjectState; // 物体相关的起始状态（如切片位置、厚度等）

function onMouseDown(event) {
  isDragging = true;

  // 记录鼠标的初始位置（关键：转换为世界坐标）
  dragStartPosition = convertMouseToWorld(event);

  // 记录物体在拖拽开始时的状态快照
  dragStartObjectState = { ...object.state };
}
```

### 步骤 2: `mousemove` — 计算绝对位移并校正

在拖拽过程中，执行核心计算。

```javascript
function onMouseMove(event) {
  if (!isDragging) return;

  // 1. 获取当前鼠标的世界坐标
  const currentWorldMouse = convertMouseToWorld(event);

  // 2. 计算从拖拽开始到现在的总位移（世界坐标系下）
  const totalDeltaWorldX = currentWorldMouse.x - dragStartPosition.x;
  const totalDeltaWorldY = currentWorldMouse.y - dragStartPosition.y;

  // 3. 根据总位移计算出物体的"理想新状态"
  const idealNewPosition = dragStartObjectState.position + convertDeltaToPosition(totalDeltaWorldX);

  // 4. 计算从"当前状态"到"理想新状态"需要修正的差值
  const correctionDelta = idealNewPosition - object.state.position;

  // 5. 将这个修正差值派发出去或直接应用
  // 这一步不仅应用了本次的移动，更关键的是它校正了所有历史累积误差
  dispatch({ type: 'drag', delta: correctionDelta });
}
```

### 步骤 3: `mouseup` — 清理状态

拖拽结束时，重置状态。

```javascript
function onMouseUp(event) {
  isDragging = false;
  dragStartPosition = null;
  dragStartObjectState = null;
}
```

## 4. 进阶要点与最佳实践

### 4.1. 坐标系统一：世界坐标 vs. 屏幕坐标

在我们的MPR案例中发现，直接使用屏幕像素 `event.clientX` 进行计算，会受到`canvas`宽高比变化的影响，导致水平和垂直方向的移动速度不一致。

**最佳实践**：在 `mousedown` 和 `mousemove` 中，立即使用`Raycaster`将屏幕坐标转换为渲染平面上的**世界坐标**。所有位移计算都在这个稳定、与屏幕像素无关的坐标系中进行，可以完美解决由`aspect ratio`（宽高比）变化带来的问题。

### 4.2. 杠杆效应：对称缩放的修正

当交互行为存在对称性时（例如我们的MIP厚度调节，拖动一侧手柄，另一侧也需要移动），需要考虑**杠杆效应**。

**最佳实践**：在计算厚度这类对称变化时，鼠标在世界坐标系中移动了距离 `d`，通常意味着总厚度的变化量是 `2 * d`。因此，在计算变化量 `thicknessChange` 时，需要额外乘以 `2`，才能让交互感觉"跟手"。

```javascript
// thicknessChange = 杠杆因子 * 世界坐标位移 * ...
const thicknessChange = totalDeltaWorldY * (sliceCount - 1) * sign * 2;
```

通过遵循这一套设计模式，可以系统性地解决各类交互式应用中的精度问题，提供稳定、可靠且符合直觉的用户体验。
