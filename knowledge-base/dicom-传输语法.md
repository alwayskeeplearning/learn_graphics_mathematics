# 知识点总结：理解DICOM传输语法 (Transfer Syntax)

`Transfer Syntax` 是DICOM标准中一个底层但至关重要的概念。它定义了整个DICOM文件的"编码打包方式"，决定了我们应如何正确地读取文件字节流，特别是如何处理像素数据。

如果说`Pixel Representation`等标签是描述DICOM文件"内容物"的说明书，那么`Transfer Syntax`就是描述"快递包裹"本身是如何打包和压缩的。

## 1. 关键标签

`Transfer Syntax` 由一个单独的、位于文件元信息组的标签来定义：

- **(0002,0010) Transfer Syntax UID**: 这是一个唯一的标识符（UID），它对应一个特定的编码规则。

一个`Transfer Syntax` UID同时定义了三件重要的事情：

### a. 字节序 (Endianness)

决定了多字节数据（如16位整数）在内存中的存储顺序。

- **Little Endian (小端)**: 低位字节在前。这是现代PC（x86/x64架构）最常用的方式。
- **Big Endian (大端)**: 高位字节在前。

### b. 值表示的显隐性 (VR Explicitness)

决定了数据元素（Data Element）中是否明确包含VR（Value Representation，如'PN', 'DA'等）。

- **Explicit VR (显式)**: 包含VR。解析时更直接，也是目前最常见的。
- **Implicit VR (隐式)**: 不包含VR。解析器需要依赖内置的DICOM字典来查询每个Tag对应的VR。

### c. 压缩方式 (Compression)

这是`Transfer Syntax`最重要的作用：指明像素数据（Pixel Data）是否被压缩，以及使用了何种压缩算法。

- **未压缩**: 像素数据是原始的、线性的字节流。
- **压缩**: 像素数据经过了算法压缩，需要先解压才能使用。常见的压缩算法有 `JPEG Baseline` (有损), `JPEG Lossless` (无损), `JPEG 2000`, `RLE` 等。

## 2. 生活类比："拆快递"

整个处理流程可以类比为"拆一个复杂的快递"：

1.  **看快递单 (读取 Transfer Syntax)**：首先看快递单上的"包装说明"，了解这个包裹是普通纸箱（未压缩），还是真空压缩袋（已压缩）。
2.  **拆外包装 (解压缩)**：
    - 如果是普通纸箱，直接打开就能拿到里面的东西（原始像素流）。
    - 如果是真空压缩袋，你必须先用剪刀把它剪开，让里面的东西膨胀恢复原状（**解压缩**），然后才能拿到原始的东西。
3.  **看说明书，组装零件 (处理 Pixel Representation)**：拿到原始的零件后（原始像素流），再去看零件的说明书(`Bits Allocated`, `Pixel Representation`)，用正确的工具（`Int16Array`, `Uint8Array`等）去"组装"和"理解"这些零件。

## 4. 常见的 Transfer Syntax UID

为了能正确判断压缩类型，了解一些常见的UID是很有必要的。

| UID                      | 名称                                         | 类型                          |
| :----------------------- | :------------------------------------------- | :---------------------------- |
| `1.2.840.10008.1.2`      | Implicit VR Little Endian                    | **未压缩** (基础，但已不常用) |
| `1.2.840.10008.1.2.1`    | Explicit VR Little Endian                    | **未压缩** (当前最通用的标准) |
| `1.2.840.10008.1.2.2`    | Explicit VR Big Endian                       | **未压缩** (较少见)           |
| `1.2.840.10008.1.2.5`    | RLE Lossless                                 | **无损压缩** (行程长度编码)   |
| `1.2.840.10008.1.2.4.50` | JPEG Baseline (Process 1)                    | **有损压缩**                  |
| `1.2.840.10008.1.2.4.70` | JPEG Lossless, Non-Hierarchical (Process 14) | **无损压缩**                  |
| `1.2.840.10008.1.2.4.90` | JPEG 2000 Image Compression (Lossless Only)  | **无损压缩**                  |
| `1.2.840.10008.1.2.4.91` | JPEG 2000 Image Compression                  | **有损或无损压缩**            |

## 5. 核心处理流程

一个健壮的DICOM解析器必须遵循以下顺序：

1.  **首先，解析文件元信息**，获取 `(0002,0010) Transfer Syntax UID`。
2.  **然后，根据此UID判断像素数据是否被压缩**。
3.  **如果已压缩**：
    a. 使用`dicom-parser`解析出包含**已压缩数据**的像素数据元素 (`dataSet.elements.x7fe00010`)。
    b. 调用**相应的解码库**（如`jpeg-lossless-decoder-js`）对这段压缩数据进行**解压**。
    c. 解压后得到一个包含**原始像素字节流**的新的`ArrayBuffer`。
4.  **如果未压缩**：
    a. `dataSet.elements.x7fe00010` 已经包含了原始像素字节流。
5.  **最后，进入像素类型解析流程**：
    a. 读取 `(0028,0100) Bits Allocated` 和 `(0028,0103) Pixel Representation`。
    b. 根据这两个标签的值，选择正确的 `TypedArray` (`Int16Array`等)，作用于上一步得到的**原始像素字节流**上，从而获得最终可用的`pixelData`数组。

**总结**：处理`Transfer Syntax`是"拆外包装"的过程，是读取像素数据的第一步，且必须在"解读内容物"（处理`Pixel Representation`）之前完成。
