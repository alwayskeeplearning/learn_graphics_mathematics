// import Loader from './loader';
// import CpuRenderer from './cpu-renderer';
// import GpuRenderer from './gpu-renderer';

// const SCROLL_THRESHOLD = 5;

// class App {
//   constructor() {
//     this.seriesDicomData = {
//       metaData: {},
//       data: [],
//     };
//     this.viewState = {
//       windowCenter: 0,
//       windowWidth: 0,
//       sliceIndex: 0,
//     };
//     this.loader = new Loader();
//     this.currentRenderer = null;
//     this.isMouseDown = false;
//     this.lastMouseX = 0;
//     this.lastMouseY = 0;
//     this.scrollAccumulator = 0;
//     this.fileInput = document.getElementById('img');
//     this.imageCount = document.getElementById('image-count');
//     this.patientName = document.getElementById('patient-name');
//     this.imageSize = document.getElementById('image-size');
//     this.sliceIndex = document.getElementById('slice-index');
//     this.windowCenter = document.getElementById('window-center');
//     this.windowWidth = document.getElementById('window-width');
//     this.cpuRendererBtn = document.getElementById('cpu-renderer');
//     this.gpuRendererBtn = document.getElementById('gpu-renderer');
//     this.windowCenterWindowWidthBtn = document.getElementById('window-center-window-width');
//     this.multiLayerScrollBtn = document.getElementById('multi-layer-scroll');
//     this.viewer = document.getElementById('viewer');
//     this.attachEvents();
//   }
//   attachEvents() {
//     this.fileInput.addEventListener('change', async e => {
//       if (!this.currentRenderer) {
//         if (this.cpuRendererBtn.classList.contains('active')) {
//           this.currentRenderer = new CpuRenderer(this.viewer);
//         } else {
//           this.currentRenderer = new GpuRenderer(this.viewer);
//         }
//       }
//       const files = e.target.files;
//       this.imageCount.textContent = '解析中...';
//       await this.loader.load(files);
//       this.seriesDicomData = this.loader.seriesDicomData;

//       this.viewState.sliceIndex = Math.floor(this.seriesDicomData.metaData.depth / 2);
//       this.viewState.windowCenter = this.seriesDicomData.metaData.windowCenter;
//       this.viewState.windowWidth = this.seriesDicomData.metaData.windowWidth;
//       this.viewState.sliceIndex = Math.max(Math.floor(this.seriesDicomData.metaData.depth / 2) - 1, 0);
//       this.updateMetadata();
//       this.updateViewState();
//       this.currentRenderer.setVolume(this.seriesDicomData);
//       this.currentRenderer.render(this.viewState);
//     });
//     this.cpuRendererBtn.addEventListener('click', () => {
//       this.cpuRendererBtn.classList.add('active');
//       this.gpuRendererBtn.classList.remove('active');
//     });
//     this.gpuRendererBtn.addEventListener('click', () => {
//       this.gpuRendererBtn.classList.add('active');
//       this.cpuRendererBtn.classList.remove('active');
//     });
//     this.windowCenterWindowWidthBtn.addEventListener('click', () => {
//       this.windowCenterWindowWidthBtn.classList.add('active');
//       this.multiLayerScrollBtn.classList.remove('active');
//     });
//     this.multiLayerScrollBtn.addEventListener('click', () => {
//       this.multiLayerScrollBtn.classList.add('active');
//       this.windowCenterWindowWidthBtn.classList.remove('active');
//     });
//     window.addEventListener('mousedown', e => {
//       this.isMouseDown = true;
//       this.lastMouseX = e.clientX;
//       this.lastMouseY = e.clientY;
//     });
//     window.addEventListener('mousemove', e => {
//       if (!this.isMouseDown) return;
//       const deltaX = e.pageX - this.lastMouseX;
//       const deltaY = e.pageY - this.lastMouseY;
//       this.lastMouseX = e.pageX;
//       this.lastMouseY = e.pageY;
//       if (this.windowCenterWindowWidthBtn.classList.contains('active')) {
//         this.viewState.windowCenter += deltaX * 1;
//         this.viewState.windowWidth += deltaY * 1;
//         if (this.viewState.windowWidth < 1) this.viewState.windowWidth = 1;

//         this.updateViewState();
//       } else if (this.multiLayerScrollBtn.classList.contains('active')) {
//         this.scrollAccumulator -= deltaY;
//         if (Math.abs(this.scrollAccumulator) >= SCROLL_THRESHOLD) {
//           const sliceChange = Math.floor(this.scrollAccumulator / SCROLL_THRESHOLD);
//           this.viewState.sliceIndex -= sliceChange;
//           this.scrollAccumulator %= SCROLL_THRESHOLD;
//           const { depth } = this.seriesDicomData.metaData;
//           this.viewState.sliceIndex = Math.max(0, Math.min(this.viewState.sliceIndex, depth - 1));
//         }
//         this.updateViewState();
//       }
//       if (this.currentRenderer) {
//         this.currentRenderer.render(this.viewState);
//       }
//     });
//     window.addEventListener('mouseup', () => {
//       this.isMouseDown = false;
//     });
//   }
//   updateMetadata() {
//     this.imageCount.textContent = this.seriesDicomData.metaData.depth;
//     this.patientName.textContent = this.seriesDicomData.metaData.patientName;
//     this.imageSize.textContent = `${this.seriesDicomData.metaData.width}x${this.seriesDicomData.metaData.height}`;
//   }
//   updateViewState() {
//     this.sliceIndex.textContent = this.viewState.sliceIndex + 1;
//     this.windowCenter.textContent = this.viewState.windowCenter;
//     this.windowWidth.textContent = this.viewState.windowWidth;
//   }
// }
// new App();
