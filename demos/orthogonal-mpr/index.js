/* eslint-disable no-unused-vars */
import * as THREE from 'three';
import Loader from './loader';
import GpuRenderer from './renderer';
import cerebralData from './cerebral.json';
import chestData from './chest.json';
import chestData1 from './chest1.json';

const SCROLL_THRESHOLD = 3;

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
      axialThickness: 0,
      coronalThickness: 0,
      sagittalThickness: 0,
      // 共享的3D罗盘（方向坐标系）
      orientation: {
        xAxis: new THREE.Vector3(1, 0, 0),
        yAxis: new THREE.Vector3(0, 1, 0),
        zAxis: new THREE.Vector3(0, 0, 1),
      },
      slabMode: 0,
      axialRotation: new THREE.Quaternion(),
      coronalRotation: new THREE.Quaternion(),
      sagittalRotation: new THREE.Quaternion(),
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
    this.axialThicknessValue = document.getElementById('axial-thickness-value');
    this.coronalThicknessValue = document.getElementById('coronal-thickness-value');
    this.sagittalThicknessValue = document.getElementById('sagittal-thickness-value');
    this.loadRemoteChestImageBtn = document.getElementById('load-remote-chest-image');
    this.loadRemoteCerebralImageBtn = document.getElementById('load-remote-cerebral-image');
    this.maxIPBtn = document.getElementById('max-ip');
    this.minIPBtn = document.getElementById('min-ip');
    this.avgIPBtn = document.getElementById('avg-ip');
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
        this.axialRenderer = new GpuRenderer(this.viewerAxial, 'axial', this.handleDrag);
        window.axialRenderer = this.axialRenderer;
        this.coronalRenderer = new GpuRenderer(this.viewerCoronal, 'coronal', this.handleDrag);
        this.sagittalRenderer = new GpuRenderer(this.viewerSagittal, 'sagittal', this.handleDrag);
      }
      const files = e.target.files;
      await this.loader.load(files);
      this.seriesDicomData = this.loader.seriesDicomData;

      this.viewState.windowCenter = this.seriesDicomData.metaData.windowCenter;
      this.viewState.windowWidth = this.seriesDicomData.metaData.windowWidth;
      this.viewState.coronalPosition = Math.floor(this.seriesDicomData.metaData.height / 2);
      this.viewState.sagittalPosition = Math.floor(this.seriesDicomData.metaData.width / 2);
      this.viewState.axialPosition = Math.floor(this.seriesDicomData.metaData.depth / 2);

      this.updateViewState();
      const sharedTexture = this.axialRenderer.setVolume(this.seriesDicomData);
      this.coronalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.sagittalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.renderAllViews();
    });
    this.windowCenterWindowWidthBtn.addEventListener('click', () => {
      this.windowCenterWindowWidthBtn.classList.add('active');
      this.multiLayerScrollBtn.classList.remove('active');
    });
    this.multiLayerScrollBtn.addEventListener('click', () => {
      this.multiLayerScrollBtn.classList.add('active');
      this.windowCenterWindowWidthBtn.classList.remove('active');
    });
    window.addEventListener('resize', this.handleResize.bind(this));
    this.maxIPBtn.addEventListener('click', () => {
      this.viewState.slabMode = 0;
      this.maxIPBtn.classList.add('active');
      this.minIPBtn.classList.remove('active');
      this.avgIPBtn.classList.remove('active');
      this.renderAllViews();
      this.updateViewState();
    });
    this.minIPBtn.addEventListener('click', () => {
      this.viewState.slabMode = 1;
      this.maxIPBtn.classList.remove('active');
      this.minIPBtn.classList.add('active');
      this.avgIPBtn.classList.remove('active');
      this.renderAllViews();
      this.updateViewState();
    });
    this.avgIPBtn.addEventListener('click', () => {
      this.viewState.slabMode = 2;
      this.maxIPBtn.classList.remove('active');
      this.minIPBtn.classList.remove('active');
      this.avgIPBtn.classList.add('active');
      this.renderAllViews();
      this.updateViewState();
    });
    this.loadRemoteChestImageBtn.addEventListener('click', async () => {
      const fetchs = chestData.images.map(image => {
        const url = `http://172.16.8.2:8000/${image.storagePath}`;
        return fetch(url).then(res => res.arrayBuffer());
      });
      const arrayBuffers = await Promise.all(fetchs);
      if (!this.axialRenderer) {
        this.axialRenderer = new GpuRenderer(this.viewerAxial, 'axial', this.handleDrag);
        this.coronalRenderer = new GpuRenderer(this.viewerCoronal, 'coronal', this.handleDrag);
        this.sagittalRenderer = new GpuRenderer(this.viewerSagittal, 'sagittal', this.handleDrag);
      }

      await this.loader.loadArrayBuffers(arrayBuffers);
      this.seriesDicomData = this.loader.seriesDicomData;

      this.viewState.windowCenter = this.seriesDicomData.metaData.windowCenter;
      this.viewState.windowWidth = this.seriesDicomData.metaData.windowWidth;
      this.viewState.coronalPosition = Math.floor(this.seriesDicomData.metaData.height / 2);
      this.viewState.sagittalPosition = Math.floor(this.seriesDicomData.metaData.width / 2);
      this.viewState.axialPosition = Math.floor(this.seriesDicomData.metaData.depth / 2);

      this.updateViewState();
      const sharedTexture = this.axialRenderer.setVolume(this.seriesDicomData);
      this.coronalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.sagittalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.renderAllViews();
    });
    this.loadRemoteCerebralImageBtn.addEventListener('click', async () => {
      const fetchs = cerebralData.images.map(image => {
        const url = `http://127.0.0.1:8000/${image.storagePath}`;
        return fetch(url).then(res => res.arrayBuffer());
      });
      const arrayBuffers = await Promise.all(fetchs);
      if (!this.axialRenderer) {
        this.axialRenderer = new GpuRenderer(this.viewerAxial, 'axial', this.handleDrag);
        this.coronalRenderer = new GpuRenderer(this.viewerCoronal, 'coronal', this.handleDrag);
        this.sagittalRenderer = new GpuRenderer(this.viewerSagittal, 'sagittal', this.handleDrag);
      }

      await this.loader.loadArrayBuffers(arrayBuffers);
      this.seriesDicomData = this.loader.seriesDicomData;

      this.viewState.windowCenter = this.seriesDicomData.metaData.windowCenter;
      this.viewState.windowWidth = this.seriesDicomData.metaData.windowWidth;
      this.viewState.coronalPosition = Math.floor(this.seriesDicomData.metaData.height / 2);
      this.viewState.sagittalPosition = Math.floor(this.seriesDicomData.metaData.width / 2);
      this.viewState.axialPosition = Math.floor(this.seriesDicomData.metaData.depth / 2);

      this.updateViewState();
      const sharedTexture = this.axialRenderer.setVolume(this.seriesDicomData);
      this.coronalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.sagittalRenderer.setVolume(this.seriesDicomData, sharedTexture);
      this.renderAllViews();
    });
    window.addEventListener('mousedown', e => {
      this.isMouseDown = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });
    window.addEventListener('mousemove', e => {
      if (!this.isMouseDown || this.hasDragTarget()) return;
      const deltaX = e.pageX - this.lastMouseX;
      const deltaY = e.pageY - this.lastMouseY;
      this.lastMouseX = e.pageX;
      this.lastMouseY = e.pageY;
      if (this.windowCenterWindowWidthBtn.classList.contains('active')) {
        this.viewState.windowCenter += deltaX * 1;
        this.viewState.windowWidth += deltaY * 1;
        if (this.viewState.windowWidth < 1) this.viewState.windowWidth = 1;

        this.updateViewState();
      } else if (this.multiLayerScrollBtn.classList.contains('active')) {
        this.scrollAccumulator -= deltaY;
        if (Math.abs(this.scrollAccumulator) >= SCROLL_THRESHOLD) {
          const sliceChange = Math.floor(this.scrollAccumulator / SCROLL_THRESHOLD);
          if (e.target.dataset.orientation === 'axial') {
            this.viewState.axialPosition -= sliceChange;
          } else if (e.target.dataset.orientation === 'coronal') {
            this.viewState.coronalPosition -= sliceChange;
          } else if (e.target.dataset.orientation === 'sagittal') {
            this.viewState.sagittalPosition -= sliceChange;
          }
          this.scrollAccumulator %= SCROLL_THRESHOLD;
          const { width, height, depth } = this.seriesDicomData.metaData;
          this.viewState.axialPosition = Math.max(0, Math.min(this.viewState.axialPosition, depth - 1));
          this.viewState.coronalPosition = Math.max(0, Math.min(this.viewState.coronalPosition, height - 1));
          this.viewState.sagittalPosition = Math.max(0, Math.min(this.viewState.sagittalPosition, width - 1));
        }
        this.updateViewState();
      }
      if (this.axialRenderer) {
        this.renderAllViews();
      }
    });
    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });
  }
  hasDragTarget() {
    return this.axialRenderer?.dragTarget || this.coronalRenderer?.dragTarget || this.sagittalRenderer?.dragTarget;
  }
  handleResize() {
    if (this.axialRenderer && this.coronalRenderer && this.sagittalRenderer) {
      this.axialRenderer.resize();
      this.coronalRenderer.resize();
      this.sagittalRenderer.resize();
    }
  }
  handleDrag(stateUpdate) {
    if (!this.seriesDicomData) return;

    if (stateUpdate.type === 'rotate') {
      const { orientation, target, deltaAngle } = stateUpdate;

      const deltaQuaternion = new THREE.Quaternion();
      console.log(orientation, target, deltaAngle);

      if (orientation === 'axial') {
        const rotationCoronal = new THREE.Vector3(0, 0, 1);
        deltaQuaternion.setFromAxisAngle(rotationCoronal, deltaAngle);
        this.viewState.coronalRotation.premultiply(deltaQuaternion);
        const rotationSagittal = new THREE.Vector3(0, 0, 1);
        deltaQuaternion.setFromAxisAngle(rotationSagittal, -deltaAngle);
        this.viewState.sagittalRotation.premultiply(deltaQuaternion);
      } else if (orientation === 'coronal') {
        const rotationAxis = new THREE.Vector3(0, 1, 0);
        deltaQuaternion.setFromAxisAngle(rotationAxis, deltaAngle);
        this.viewState.axialRotation.premultiply(deltaQuaternion);

        const rotationSagittal = new THREE.Vector3(0, 1, 0);
        deltaQuaternion.setFromAxisAngle(rotationSagittal, -deltaAngle);
        this.viewState.sagittalRotation.premultiply(deltaQuaternion);
      } else if (orientation === 'sagittal') {
        const rotationAxis = new THREE.Vector3(1, 0, 0);
        deltaQuaternion.setFromAxisAngle(rotationAxis, deltaAngle);
        this.viewState.axialRotation.premultiply(deltaQuaternion);

        const rotationCoronal = new THREE.Vector3(1, 0, 0);
        deltaQuaternion.setFromAxisAngle(rotationCoronal, -deltaAngle);
        this.viewState.coronalRotation.premultiply(deltaQuaternion);
      }

      this.renderAllViews();
      return;
    }

    if (stateUpdate.type === 'drag') {
      stateUpdate.changes.forEach(change => {
        if (!change) return;

        if (change.type === 'handle') {
          const thicknessKey = `${change.target}Thickness`;
          const currentThickness = this.viewState[thicknessKey] || 0;
          this.viewState[thicknessKey] = currentThickness + change.delta;
        } else if (change.type === 'line') {
          const posKey = `${change.target}Position`;
          const currentPosition = this.viewState[posKey] || 0;
          this.viewState[posKey] = currentPosition + change.delta;
        }
      });
    }

    this.updateViewState();
    this.renderAllViews();
  }

  renderAllViews() {
    this.axialRenderer.render(this.viewState);
    this.coronalRenderer.render(this.viewState);
    this.sagittalRenderer.render(this.viewState);
  }

  updateViewState() {
    this.windowWidthValue.textContent = Math.round(this.viewState.windowWidth);
    this.windowCenterValue.textContent = Math.round(this.viewState.windowCenter);
    this.axialPositionValue.textContent = Math.round(this.viewState.axialPosition);
    this.coronalPositionValue.textContent = Math.round(this.viewState.coronalPosition);
    this.sagittalPositionValue.textContent = Math.round(this.viewState.sagittalPosition);
    this.axialThicknessValue.textContent = Math.round(this.viewState.axialThickness);
    this.coronalThicknessValue.textContent = Math.round(this.viewState.coronalThickness);
    this.sagittalThicknessValue.textContent = Math.round(this.viewState.sagittalThickness);
  }
}

const app = new App();
window.app = app;
