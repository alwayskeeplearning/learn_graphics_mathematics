# 按需渲染与性能优化：聪明的"脏检查"机制

在图形应用中，渲染循环是性能的心脏。一个朴素的渲染循环会不分青红皂白地在每一帧都重绘整个场景，即便画面毫无变化。这就像一个过于勤奋的画家，不停地重画一幅已经完成的画，极大地浪费了颜料（GPU资源）和体力（电量）。

为了解决这个问题，我们引入了 **按需渲染（On-Demand Rendering）** 的策略。其核心思想是：**没有变化，就绝不重绘**。

## 核心思想：从"持续渲染"到"按需渲染"

我们将渲染器从一个"勤奋的画家"升级为一位"聪明的画家"。他的工作原则如下：

1.  **"脏"检查 (Dirty Checking)**: 我们引入一个布尔标记，例如 `isDirty`。当场景中任何元素（如相机位置、物体属性、窗口大小）发生变化时，我们就将场景标记为"脏"（`isDirty = true`）。
2.  **调度渲染**: 仅仅标记为"脏"还不够。我们使用 `requestAnimationFrame` 来向浏览器请求在下一个最佳时机执行我们的渲染函数。这确保了渲染与浏览器的刷新周期同步，避免了不必要的计算和画面撕裂。
3.  **按需执行**: 在由 `requestAnimationFrame` 调度的渲染函数中，我们首先检查 `isDirty` 标记。如果为 `true`，则执行渲染，并将标记重置为 `false`；如果为 `false`，则直接跳过，不执行任何渲染操作。

```javascript
// 伪代码示例
let isDirty = false;

function invalidate() {
  isDirty = true;
  requestRender();
}

function requestRender() {
  // 请求一次渲染，但防止重复请求
  if (!renderRequested) {
    renderRequested = true;
    requestAnimationFrame(performRender);
  }
}

function performRender() {
  renderRequested = false;
  if (isDirty) {
    renderer.render(scene, camera);
    isDirty = false;
  }
}
```

## 进阶优化：使用FPS节流阀

对于高频事件（如 `mousemove`），即便是按需渲染也可能导致渲染过于频繁。因此，我们可以设置一个目标FPS（例如30），只在距离上次渲染超过特定时间间隔（`1000ms / 30fps = 33.3ms`）后才执行渲染。

## 精髓：解决"唤醒卡顿"的时间戳校准

当用户切换浏览器标签页，导致应用长时间"休眠"后，一个关键的优化点在于如何平滑地恢复渲染节拍。

### 问题场景

假设应用在休眠5秒后被唤醒并立即触发一次渲染。为了更清晰地理解，我们设定一个具体场景：

- **目标帧率**: `fps = 30`，因此渲染间隔 `interval = 1000 / 30 ≈ 33.3ms`。
- **上次渲染**: 发生在 `10,000ms`，所以 `lastRenderTime = 10000`。
- **休眠与唤醒**: 应用休眠了5秒，在 `15,000ms` 时因用户操作而被唤醒。

#### 1. 朴素做法（无校准）

如果我们只是简单地在渲染后用当前时间更新 `lastRenderTime`： `this.lastRenderTime = now;`

- **第一次渲染 (15,000ms)**:
  - `now = 15000`, `elapsed = 15000 - 10000 = 5000ms`。
  - `5000ms >= 33.3ms`，条件成立，执行渲染。
  - `lastRenderTime` 更新为 `15000`。
- **紧接着的第二次渲染 (假设在 15,016ms 触发)**:
  - `now = 15016`, `elapsed = 15016 - 15000 = 16ms`。
  - `16ms < 33.3ms`，**条件不成立**！渲染被跳过。

**结果**：用户的第二次操作没有得到即时响应，造成了可感知的延迟和卡顿。

#### 2. 智能做法（带时间戳校准）

我们使用校准代码： `this.lastRenderTime = now - (elapsed % this.interval);`

- **第一次渲染 (15,000ms)**:
  - `now = 15000`, `elapsed = 5000ms`, `interval ≈ 33.3ms`。
  - 计算余数：`5000 % 33.3...` 约等于 `0`。为便于理解，我们假设 `interval` 是 `30ms`，则 `5000 % 30 = 20ms`。
  - `lastRenderTime` 更新为 `15000 - 20 = 14980`。注意，它没有被设置为`15000`！
- **紧接着的第二次渲染 (在 15,016ms 触发)**:
  - `now = 15016`, `elapsed = 15016 - 14980 = 36ms`。
  - `36ms >= 33.3ms`，**条件成立**！渲染立刻执行。

**结果**：即便是紧随其后的操作也得到了即时响应，交互保持流畅。

现在，我们可以通过代码来理解这两种做法的差异：

- **朴素做法**: 直接在渲染后将 `lastRenderTime` 更新为当前时间 `now`。这会导致下一次渲染请求因为与 `now` 的时间间隔过短而被拒绝，造成可感知的卡顿。
- **智能做法**: 使用时间戳校准。

  ```javascript
  this.lastRenderTime = now - (elapsed % this.interval);
  ```

### 最终实现

```javascript
/**
 * @description 执行实际的渲染操作。
 * 这个方法由`requestAnimationFrame`在浏览器认为合适的时机（通常是下一次垂直同步）调用。
 * 它会检查场景是否为"脏"，以及是否满足FPS限制，只有满足条件时才执行真正的渲染。
 */
_performRender() {
  // 允许下一帧的渲染请求
  this.renderRequested = false;

  const now = performance.now();
  // 计算距离上次渲染的时间间隔
  const elapsed = now - this.lastRenderTime;

  // 只有当场景是"脏"的，并且距离上次渲染的时间间隔已足够长，才执行绘制
  if (this.isDirty && elapsed >= this.interval) {
    // 校准时间戳，防止因长时间无活动（例如标签页切换）后，
    // `elapsed`变得巨大而导致跳帧后的连续渲染。
    // 这确保了渲染节奏的平滑。
    this.lastRenderTime = now - (elapsed % this.interval);

    this.renderer.render(this.scene, this.camera);
    // 渲染完成，将场景标记为"干净"
    this.isDirty = false;
  }

  // 如果因为FPS限制而跳过了本次渲染，但场景仍然是"脏"的，
  // 我们需要再次请求下一帧，以确保这个更新最终能被绘制出来。
  if (this.isDirty) {
    this._requestRender();
  }
}
```

通过这套完整的按需渲染与优化机制，我们可以极大地降低CPU/GPU负载，延长电池寿命，并为用户提供一个始终保持流畅和响应的交互体验。
