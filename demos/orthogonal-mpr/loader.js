import dicomParser from 'dicom-parser';

class Loader {
  constructor() {
    this.seriesDicomData = {
      metaData: undefined,
      data: [],
    };
  }
  async load(files) {
    for (const file of files) {
      await this.parseDicom(file);
    }
    this.seriesDicomData.data.sort((a, b) => b.z - a.z);
    this.seriesDicomData.metaData.depth = files.length;
  }
  async parseDicom(file) {
    const reader = new FileReader();
    return new Promise(resolve => {
      reader.onload = e => {
        const arrayBuffer = e.target.result;
        const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
        if (!this.seriesDicomData.metaData) {
          this.seriesDicomData.metaData = {
            patientName: dataSet.string('x00100010'),
            width: dataSet.uint16('x00280010'),
            height: dataSet.uint16('x00280011'),
            pixelSpacing: dataSet.string('x00280030').split('\\').map(parseFloat),
            sliceThickness: dataSet.floatString('x00180050'),
            windowCenter: dataSet.floatString('x00281050', 0),
            windowWidth: dataSet.floatString('x00281051', 0),
            rescaleSlope: dataSet.floatString('x00281053', 0),
            rescaleIntercept: dataSet.floatString('x00281052', 0),
            bitsAllocated: dataSet.uint16('x00280100'),
            pixelRepresentation: dataSet.uint16('x00280103'),
          };
        }
        const { bitsAllocated, pixelRepresentation } = this.seriesDicomData.metaData;
        const pixelDataElement = dataSet.elements.x7fe00010;
        let pixelData;
        if (bitsAllocated === 16) {
          const pixelArray = pixelRepresentation === 1 ? Int16Array : Uint16Array;
          pixelData = new pixelArray(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length / 2);
        } else if (bitsAllocated === 8) {
          const pixelArray = pixelRepresentation === 1 ? Int8Array : Uint8Array;
          pixelData = new pixelArray(arrayBuffer, pixelDataElement.dataOffset, pixelDataElement.length);
        } else {
          throw new Error(`不支持的位深 (Bits Allocated): ${bitsAllocated}`);
        }
        this.seriesDicomData.data.push({
          pixelData,
          z: dataSet.string('x00200032').split('\\').map(parseFloat)[2],
        });
        resolve();
      };
      reader.readAsArrayBuffer(file);
    });
  }
}

export default Loader;
