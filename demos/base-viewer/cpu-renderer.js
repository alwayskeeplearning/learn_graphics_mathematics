class CpuRenderer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
    this.container.style.position = this.container.style.position || 'relative';
    this.resize();
  }
  resize() {
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.objectFit = 'contain';
  }
  setVolume(seriesDicomData) {
    this.volume = seriesDicomData;
  }
  render(viewState) {
    this.ctx.clearRect(0, 0, width, height);
    const { windowCenter, windowWidth, sliceIndex } = viewState;
    const { data, metaData } = this.volume;
    const pixelData = data[sliceIndex].pixelData;
    const { width, height, rescaleSlope, rescaleIntercept } = metaData;
    this.canvas.width = width;
    this.canvas.height = height;
    const imageData = this.ctx.createImageData(width, height);
    // -- 4. 窗宽窗位核心算法，遍历并填充ImageData --
    const lowerBound = windowCenter - windowWidth / 2;
    const upperBound = windowCenter + windowWidth / 2;

    for (let i = 0; i < pixelData.length; i++) {
      // 应用斜率和截距，得到真实的HU值
      const huValue = pixelData[i] * rescaleSlope + rescaleIntercept;

      // 将HU值通过窗宽窗位映射到0-255的灰度值
      let grayValue = ((huValue - lowerBound) / (upperBound - lowerBound)) * 255;
      grayValue = Math.max(0, Math.min(255, grayValue)); // clamp

      // 将灰度值填充到ImageData中 (R, G, B, A)
      const index = i * 4;
      imageData.data[index] = grayValue; // R
      imageData.data[index + 1] = grayValue; // G
      imageData.data[index + 2] = grayValue; // B
      imageData.data[index + 3] = 255; // A (不透明)
    }

    // -- 5. 将处理好的像素数据一次性绘制到Canvas上 --
    this.ctx.putImageData(imageData, 0, 0);
  }
}

export default CpuRenderer;
