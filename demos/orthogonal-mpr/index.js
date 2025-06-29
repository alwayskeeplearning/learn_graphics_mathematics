import Loader from './loader';
import CpuRenderer from './cpu-renderer';
import GpuRenderer from './gpu-renderer';

// const SCROLL_THRESHOLD = 5;

class App {
  constructor() {
    this.seriesDicomData = {
      metaData: {},
      data: [],
    };
    this.viewState = {
      windowCenter: 0,
      windowWidth: 0,
      axialPosition: 0,
      coronalPosition: 0,
      sagittalPosition: 0,
    };
    this.loader = new Loader();
    this.axialRenderer = null;
    this.coronalRenderer = null;
    this.sagittalRenderer = null;
    this.isMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.scrollAccumulator = 0;
    this.fileInput = document.getElementById('file-input');
    this.windowWidthValue = document.getElementById('window-width-value');
    this.windowCenterValue = document.getElementById('window-center-value');
    this.axialPositionValue = document.getElementById('axial-position-value');
    this.coronalPositionValue = document.getElementById('coronal-position-value');
    this.sagittalPositionValue = document.getElementById('sagittal-position-value');
    this.windowWidth = document.getElementById('window-width');
    this.windowCenter = document.getElementById('window-center');
    this.axialPosition = document.getElementById('axial-position');
    this.coronalPosition = document.getElementById('coronal-position');
    this.sagittalPosition = document.getElementById('sagittal-position');
    this.cpuRendererBtn = document.getElementById('cpu-renderer');
    this.gpuRendererBtn = document.getElementById('gpu-renderer');
    this.windowCenterWindowWidthBtn = document.getElementById('window-center-window-width');
    this.multiLayerScrollBtn = document.getElementById('multi-layer-scroll');
    this.viewerAxial = document.getElementById('viewer-axial');
    this.viewerCoronal = document.getElementById('viewer-coronal');
    this.viewerSagittal = document.getElementById('viewer-sagittal');
    this.attachEvents();
    this.handleDrag = this.handleDrag.bind(this);
  }
  attachEvents() {
    this.fileInput.addEventListener('change', async e => {
      if (!this.axialRenderer) {
        if (this.cpuRendererBtn.classList.contains('active')) {
          this.currentRenderer = new CpuRenderer(this.viewer);
        } else {
          this.axialRenderer = new GpuRenderer(this.viewerAxial, 'axial', this.handleDrag);
          this.coronalRenderer = new GpuRenderer(this.viewerCoronal, 'coronal', this.handleDrag);
          this.sagittalRenderer = new GpuRenderer(this.viewerSagittal, 'sagittal', this.handleDrag);
        }
      }
      const files = e.target.files;
      await this.loader.load(files);
      this.seriesDicomData = this.loader.seriesDicomData;

      this.viewState.windowCenter = this.seriesDicomData.metaData.windowCenter;
      this.viewState.windowWidth = this.seriesDicomData.metaData.windowWidth;
      this.viewState.coronalPosition = Math.floor(this.seriesDicomData.metaData.width / 2);
      this.viewState.sagittalPosition = Math.floor(this.seriesDicomData.metaData.height / 2);
      this.viewState.axialPosition = Math.floor(this.seriesDicomData.metaData.depth / 2);
      this.axialPosition.max = this.seriesDicomData.metaData.depth - 1;
      this.coronalPosition.max = this.seriesDicomData.metaData.width - 1;
      this.sagittalPosition.max = this.seriesDicomData.metaData.height - 1;
      this.updateViewState();
      const sharedTexture = this.axialRenderer.setVolume(this.seriesDicomData);
      this.coronalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.sagittalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.renderAllViews();
    });
    this.cpuRendererBtn.addEventListener('click', () => {
      this.cpuRendererBtn.classList.add('active');
      this.gpuRendererBtn.classList.remove('active');
    });
    this.gpuRendererBtn.addEventListener('click', () => {
      this.gpuRendererBtn.classList.add('active');
      this.cpuRendererBtn.classList.remove('active');
    });
    this.windowCenterWindowWidthBtn.addEventListener('click', () => {
      this.windowCenterWindowWidthBtn.classList.add('active');
      this.multiLayerScrollBtn.classList.remove('active');
    });
    this.multiLayerScrollBtn.addEventListener('click', () => {
      this.multiLayerScrollBtn.classList.add('active');
      this.windowCenterWindowWidthBtn.classList.remove('active');
    });
    this.axialPosition.addEventListener('input', e => {
      this.viewState.axialPosition = e.target.value;
      this.renderAllViews();
      this.updateViewState();
    });
    this.coronalPosition.addEventListener('input', e => {
      this.viewState.coronalPosition = e.target.value;
      this.renderAllViews();
      this.updateViewState();
    });
    this.sagittalPosition.addEventListener('input', e => {
      this.viewState.sagittalPosition = e.target.value;
      this.renderAllViews();
      this.updateViewState();
    });
    this.windowWidth.addEventListener('input', e => {
      this.viewState.windowWidth = e.target.value;
      this.renderAllViews();
      this.updateViewState();
    });
    this.windowCenter.addEventListener('input', e => {
      this.viewState.windowCenter = e.target.value;
      this.renderAllViews();
      this.updateViewState();
    });
    window.addEventListener('resize', this.handleResize.bind(this));
    // window.addEventListener('mousedown', e => {
    //   this.isMouseDown = true;
    //   this.lastMouseX = e.clientX;
    //   this.lastMouseY = e.clientY;
    // });
    // window.addEventListener('mousemove', e => {
    //   if (!this.isMouseDown) return;
    //   const deltaX = e.pageX - this.lastMouseX;
    //   const deltaY = e.pageY - this.lastMouseY;
    //   this.lastMouseX = e.pageX;
    //   this.lastMouseY = e.pageY;
    //   if (this.windowCenterWindowWidthBtn.classList.contains('active')) {
    //     this.viewState.windowCenter += deltaX * 1;
    //     this.viewState.windowWidth += deltaY * 1;
    //     if (this.viewState.windowWidth < 1) this.viewState.windowWidth = 1;

    //     this.updateViewState();
    //   } else if (this.multiLayerScrollBtn.classList.contains('active')) {
    //     this.scrollAccumulator -= deltaY;
    //     if (Math.abs(this.scrollAccumulator) >= SCROLL_THRESHOLD) {
    //       const sliceChange = Math.floor(this.scrollAccumulator / SCROLL_THRESHOLD);
    //       this.viewState.sliceIndex -= sliceChange;
    //       this.scrollAccumulator %= SCROLL_THRESHOLD;
    //       const { depth } = this.seriesDicomData.metaData;
    //       this.viewState.sliceIndex = Math.max(0, Math.min(this.viewState.sliceIndex, depth - 1));
    //     }
    //     this.updateViewState();
    //   }
    //   if (this.currentRenderer) {
    //     this.currentRenderer.render(this.viewState);
    //   }
    // });
    // window.addEventListener('mouseup', () => {
    //   this.isMouseDown = false;
    // });
  }
  handleResize() {
    if (this.axialRenderer && this.coronalRenderer && this.sagittalRenderer) {
      console.log('handleResize');
      this.axialRenderer.resize();
      this.coronalRenderer.resize();
      this.sagittalRenderer.resize();
      this.renderAllViews();
    }
  }
  handleDrag(stateUpdate) {
    if (stateUpdate.type !== 'drag' || !this.seriesDicomData) return;

    // const { metaData } = this.seriesDicomData;
    // const maxPositions = {
    //   axial: metaData.depth - 1,
    //   coronal: metaData.width - 1,
    //   sagittal: metaData.height - 1,
    // };

    stateUpdate.changes.forEach(({ target, delta }) => {
      console.log('axis', target, delta);

      if (!target) return;
      const posKey = `${target}Position`;
      let newPosition = Number(this.viewState[posKey]) + delta;
      // newPosition = Math.max(0, Math.min(maxPositions[target], newPosition));
      this.viewState[posKey] = Math.round(newPosition);
    });

    this.updateViewState();
    this.renderAllViews();
  }

  renderAllViews() {
    this.axialRenderer.render(this.viewState);
    this.coronalRenderer.render(this.viewState);
    this.sagittalRenderer.render(this.viewState);
  }

  updateViewState() {
    this.axialPositionValue.textContent = Math.min(this.viewState.axialPosition, this.seriesDicomData.metaData.depth - 1);
    this.coronalPositionValue.textContent = Math.min(this.viewState.coronalPosition, this.seriesDicomData.metaData.width - 1);
    this.sagittalPositionValue.textContent = Math.min(this.viewState.sagittalPosition, this.seriesDicomData.metaData.height - 1);
    this.windowCenterValue.textContent = this.viewState.windowCenter;
    this.windowWidthValue.textContent = this.viewState.windowWidth;
    this.axialPosition.value = Math.min(this.viewState.axialPosition, this.seriesDicomData.metaData.depth - 1);
    this.coronalPosition.value = Math.min(this.viewState.coronalPosition, this.seriesDicomData.metaData.width - 1);
    this.sagittalPosition.value = Math.min(this.viewState.sagittalPosition, this.seriesDicomData.metaData.height - 1);
  }
}
new App();
