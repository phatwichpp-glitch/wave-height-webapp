# Prompt สำหรับ Claude Code: เว็บแอปวัดความสูงคลื่นน้ำ (Client-Side, Deploy บน Vercel)

**วิธีใช้เอกสารนี้:** คัดลอก prompt ของแต่ละเฟสไปวางใน Claude Code ทีละเฟส ตรวจสอบผลก่อนไปเฟสถัดไป
เอกสารนี้เป็นคนละชุดกับ "wave_height_analyzer_prompts.md" (เวอร์ชัน Python/OpenCV) — ใช้สแต็กและสถาปัตยกรรมคนละแบบ ห้ามผสมกัน

**สรุปสถาปัตยกรรม:**
- Next.js (App Router) + TypeScript + Tailwind CSS
- ประมวลผล**ทั้งหมดในเบราว์เซอร์ฝั่งไคลเอนต์** — ไม่มี backend, ไม่มีการอัปโหลดวิดีโอขึ้นเซิร์ฟเวอร์ (วิดีโอโหลดผ่าน `<video>` element จากไฟล์ในเครื่องผู้ใช้โดยตรงด้วย `URL.createObjectURL`)
- ดึงเฟรมด้วย Canvas API (`drawImage` จาก video element ลง canvas แล้วอ่าน `getImageData`)
- ประมวลผลหนัก (loop หลายพันเฟรม) ทำใน **Web Worker** เพื่อไม่ให้ UI หลัก freeze
- กราฟด้วย `recharts`
- Deploy บน Vercel ด้วย `next build` มาตรฐาน ไม่ต้องมี API routes เลย (static export ได้ถ้าต้องการ)

---

## Phase 0: Next.js Project Scaffolding

```
สร้างโปรเจกต์ Next.js ใหม่ชื่อ "wave-height-webapp" ด้วย App Router, TypeScript, Tailwind CSS, ESLint

ใช้คำสั่ง create-next-app แบบไม่ interactive (ระบุ flags ให้ครบ: --typescript --tailwind --eslint --app --src-dir --import-alias "@/*")

โครงสร้างโฟลเดอร์ที่ต้องการเพิ่มเติมภายใต้ src/:
src/
├── app/
│   ├── page.tsx              (หน้าแรก จะเติมเนื้อหาใน Phase 1)
│   └── layout.tsx
├── lib/
│   ├── calibration.ts         (ว่างไว้ก่อน เติมใน Phase 1)
│   ├── surfaceDetector.ts     (ว่างไว้ก่อน เติมใน Phase 2)
│   ├── videoProcessor.ts      (ว่างไว้ก่อน เติมใน Phase 3)
│   ├── waveStatistics.ts      (ว่างไว้ก่อน เติมใน Phase 4)
│   └── csvExport.ts           (ว่างไว้ก่อน เติมใน Phase 5)
├── workers/
│   └── videoProcessing.worker.ts  (ว่างไว้ก่อน เติมใน Phase 3)
├── components/                (ว่างไว้ เติมใน Phase 1 เป็นต้นไป)
└── types/
    └── wave.ts                 (type definitions ที่ใช้ร่วมกันทั้งโปรเจกต์)

ติดตั้ง dependencies เพิ่มเติม: recharts, vitest, @vitejs/plugin-react, jsdom, @testing-library/react, @testing-library/jest-dom
ตั้งค่า vitest ให้รันคู่กับ Next.js ได้ (vitest.config.ts) รองรับ jsdom environment สำหรับเทส component และ node environment แยกสำหรับเทสฟังก์ชัน pure logic

ใน src/types/wave.ts ให้นิยาม TypeScript interfaces หลักไว้ล่วงหน้า (จะใช้ตลอดทุกเฟส):

interface CalibrationData {
  point1: { x: number; y: number };
  point2: { x: number; y: number };
  knownDistanceCm: number;
  pixelsPerCm: number;
}

interface WaveDataPoint {
  timeS: number;
  elevationCm: number;
  confidence: number;
}

interface WaveEvent {
  tStart: number;
  tEnd: number;
  periodS: number;
  heightCm: number;
}

interface WaveStatistics {
  nWaves: number;
  hMax: number;
  hMean: number;
  hRms: number;
  hSignificant: number;
  periodMeanS: number;
  periodSignificantS: number;
  waves: WaveEvent[];
}

เพิ่มไฟล์ vercel.json ถ้าจำเป็น (ปกติ Next.js ไม่ต้องตั้งค่าอะไรพิเศษสำหรับ Vercel default) และตรวจสอบว่า `npm run build` ผ่านไม่มี error
เพิ่ม README.md อธิบาย overview ของโปรเจกต์และวิธี deploy ด้วย Vercel CLI (`vercel` / `vercel --prod`)

รันทดสอบสุดท้าย: `npm run build` และ `npm run lint` ต้องผ่านทั้งคู่ รายงานผล
```

**เกณฑ์ผ่านเฟส:** `npm run build` และ `npm run lint` ผ่านไม่มี error, โครงสร้างไฟล์ครบตามที่ระบุ

---

## Phase 1: Video Upload, Frame Capture, และ Calibration UI

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp เติมเนื้อหา src/lib/calibration.ts และสร้างหน้า UI สำหรับอัปโหลดวิดีโอ + calibrate

ส่วนที่ 1 — src/lib/calibration.ts (pure functions ไม่แตะ DOM โดยตรง เพื่อเทสง่าย):

export function calculatePixelsPerCm(
  point1: { x: number; y: number },
  point2: { x: number; y: number },
  knownDistanceCm: number
): number
- คำนวณระยะ Euclidean ระหว่างจุด แล้วหารด้วย knownDistanceCm
- throw Error ถ้า knownDistanceCm <= 0 หรือจุดทั้งสองซ้ำกัน (ระยะพิกเซล = 0)

export function saveCalibrationToLocalStorage(data: CalibrationData): void
export function loadCalibrationFromLocalStorage(): CalibrationData | null
- ใช้ localStorage เก็บ calibration ล่าสุดไว้ใช้ซ้ำ (key: "wave-analyzer-calibration") กัน user ต้อง calibrate ใหม่ทุกครั้งถ้าใช้กล้อง/ระยะเดิม
- ห่อ try-catch เพราะ localStorage อาจไม่พร้อมใช้งานบางสภาพแวดล้อม (เช่น private browsing บาง browser)

ส่วนที่ 2 — src/components/VideoUploader.tsx:
- Component รับไฟล์วิดีโอผ่าน <input type="file" accept="video/*">
- สร้าง object URL ด้วย URL.createObjectURL(file) แล้วส่งขึ้นไปให้ parent ผ่าน callback prop onVideoLoaded(videoUrl: string, file: File)
- แสดง preview วิดีโอเล็ก ๆ ด้วย <video controls>
- ลบ object URL เก่าด้วย URL.revokeObjectURL เมื่อมีการโหลดไฟล์ใหม่ (ป้องกัน memory leak)

ส่วนที่ 3 — src/components/CalibrationCanvas.tsx:
- Component รับ videoUrl: string เป็น prop
- โหลดวิดีโอ, seek ไปเฟรมแรก (currentTime = 0), รอ event 'seeked' หรือ 'loadeddata' แล้ว draw ลง <canvas> ด้วย canvas.getContext('2d').drawImage(video, 0, 0)
- ให้ผู้ใช้คลิกบน canvas 2 จุด (onClick handler อ่านตำแหน่ง event.offsetX/offsetY หรือคำนวณจาก getBoundingClientRect ให้พิกัดตรงกับพิกเซลจริงของ canvas ไม่ใช่พิกเซลที่แสดงผลบนจอถ้าขนาดแสดงผลกับ canvas resolution ไม่เท่ากัน — ต้อง scale ให้ถูกต้อง)
- วาดจุดวงกลมเล็ก ๆ สีแดงทับตำแหน่งที่คลิกแล้ว พร้อมเส้นเชื่อมระหว่าง 2 จุด ให้เห็น feedback ทันที
- มีปุ่ม "รีเซ็ต" ให้คลิกใหม่
- มี input number ให้กรอกระยะจริง (knownDistanceCm) ของสองจุดนั้น
- เมื่อคลิกครบ 2 จุด + กรอกระยะแล้ว ให้ enable ปุ่ม "ยืนยัน Calibration" ซึ่งเรียก calculatePixelsPerCm แล้วส่งผล CalibrationData ขึ้นไปให้ parent ผ่าน callback onCalibrated(data: CalibrationData)
- เพิ่มปุ่ม "ใช้ค่า Calibration ที่บันทึกไว้" ถ้ามีข้อมูลใน localStorage (โหลดด้วย loadCalibrationFromLocalStorage) ให้ผู้ใช้เลือกข้ามขั้นตอนคลิกใหม่ได้

ส่วนที่ 4 — src/app/page.tsx:
- ประกอบ VideoUploader และ CalibrationCanvas เข้าด้วยกันเป็น flow ทีละขั้น: อัปโหลดวิดีโอก่อน → แสดง CalibrationCanvas → เก็บ state CalibrationData ไว้ใน React state (useState) เพื่อใช้ในเฟสถัดไป
- ใช้ Tailwind จัดหน้าให้ดูสะอาดตา เป็นขั้นตอน step-by-step ชัดเจน (เช่นใช้ตัวเลข 1,2,3 กำกับแต่ละขั้น)

เขียน unit test ในไฟล์ src/lib/calibration.test.ts (ใช้ vitest):
- test calculatePixelsPerCm กับจุด (0,0) และ (0,100) ระยะจริง 10cm → ต้องได้ 10.0
- test throw Error เมื่อ knownDistanceCm <= 0
- test throw Error เมื่อจุดซ้ำกัน
- test saveCalibrationToLocalStorage/loadCalibrationFromLocalStorage round-trip (mock localStorage ด้วย jsdom environment ของ vitest)

รันเทสด้วย `npm run test` (ตั้ง script นี้ใน package.json ให้เรียก vitest) รายงานผล
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด, ทดสอบด้วยมือ (`npm run dev`) อัปโหลดวิดีโอจริงแล้วคลิก calibrate ได้จริงในเบราว์เซอร์

---

## Phase 2: Water Surface Detection Algorithm (Pure TS Logic)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp เติมเนื้อหา src/lib/surfaceDetector.ts

โมดูลนี้เป็น pure functions ไม่แตะ DOM/canvas โดยตรง (รับ/คืนค่าเป็น array ตัวเลขธรรมดา) เพื่อให้เทสง่ายและใช้ซ้ำได้ทั้งใน main thread และ web worker

export function extractColumnProfile(
  imageData: ImageData,
  x: number,
  columnWidth: number = 3
): Float32Array
- แปลงแต่ละพิกเซลเป็น grayscale ด้วยสูตร luminance มาตรฐาน (0.299*R + 0.587*G + 0.114*B)
- เฉลี่ยความสว่างของคอลัมน์ตั้งแต่ x - Math.floor(columnWidth/2) ถึง x + Math.floor(columnWidth/2) (clamp ไม่ให้ index ออกนอกภาพ)
- คืนค่า Float32Array ความยาว = imageData.height (index 0 = แถวบนสุด)

export function gaussianSmooth1D(signal: Float32Array, sigma: number = 2.0): Float32Array
- implement Gaussian smoothing เอง (สร้าง kernel จาก sigma, ทำ convolution แบบ 1D) เพราะไม่มี scipy ให้พึ่ง
- kernel radius ประมาณ Math.ceil(sigma * 3)
- จัดการขอบสัญญาณด้วยวิธี edge-padding (clamp index ที่ขอบ)

export function computeGradient(signal: Float32Array): Float32Array
- central difference gradient เหมือน np.gradient (จุดกลางใช้ (signal[i+1]-signal[i-1])/2, จุดขอบใช้ forward/backward difference)

export interface EdgeResult { yPosition: number; confidence: number; }

export function findSurfaceEdge(
  profile: Float32Array,
  searchRange: [number, number] | null = null,
  smoothSigma: number = 2.0
): EdgeResult
- smooth profile ด้วย gaussianSmooth1D
- คำนวณ gradient ด้วย computeGradient
- ถ้ามี searchRange ให้จำกัดการหาค่า max เฉพาะช่วง [min, max] นั้น (clamp ให้อยู่ในขอบเขตของ array)
- หา index ที่ |gradient| มีค่าสูงสุดในช่วงที่กำหนด = yPosition
- confidence = maxAbsGradient / meanAbsGradient (ในช่วงที่ค้นหา)
- คืนค่า { yPosition, confidence }

export class SurfaceTracker {
  private lastY: number | null = null
  constructor(
    private xColumn: number,
    private columnWidth: number = 3,
    private searchMarginPx: number = 40,
    private smoothSigma: number = 2.0
  ) {}

  detect(imageData: ImageData): EdgeResult
  - ถ้า this.lastY === null: ค้นหาทั่วภาพ (searchRange = null)
  - ถ้าไม่: searchRange = [lastY - searchMarginPx, lastY + searchMarginPx]
  - เรียก extractColumnProfile แล้ว findSurfaceEdge
  - อัปเดต this.lastY ก่อน return ผล

  reset(): void  // เคลียร์ lastY กลับเป็น null
}

เขียน unit test ในไฟล์ src/lib/surfaceDetector.test.ts (ใช้ vitest, environment node พอเพราะไม่แตะ DOM จริง แต่ต้อง mock ImageData — เขียน helper function สร้าง fake ImageData object ธรรมดา { data: Uint8ClampedArray, width, height } ไม่ต้องพึ่ง browser API จริงเพราะ vitest node environment ไม่มี ImageData ให้ในตัว):

- สร้างภาพปลอมสูง 200px กว้าง 100px, RGBA data ที่แถวบน (y < 100) ทุก pixel = [200,200,200,255] (สว่าง จำลองอากาศ) แถวล่าง (y >= 100) = [80,80,80,255] (มืด จำลองน้ำ) → test ว่า findSurfaceEdge บนคอลัมน์ profile ที่ extract มา เจอ yPosition ใกล้เคียง 100 (error ไม่เกิน 3px)
- test SurfaceTracker.detect เรียกต่อเนื่องหลายครั้งที่ตำแหน่งรอยต่อขยับทีละ 1-2px ระหว่างเฟรม → tracker ต้องตามตำแหน่งได้ต่อเนื่อง
- test ว่า tracker ไม่หลุดไปติด edge ปลอมที่อยู่นอก searchMarginPx (สร้างภาพที่มี edge จริงที่ y=100 และ edge ปลอมสว่างจ้าที่ y=180 ให้ tracker ที่ track อยู่แถว y=100 ต้องไม่กระโดดไปที่ 180)
- test gaussianSmooth1D ว่าไม่เปลี่ยนความยาว array และค่าเฉลี่ยรวมใกล้เคียงเดิม (สัญญาณ constant ควร smooth แล้วได้ค่าเดิมทุก index)
- test computeGradient กับสัญญาณ linear ramp (เช่น [0,1,2,3,4,5]) → gradient ควรได้ประมาณ 1 ทุกจุด

รันเทสด้วย `npm run test` รายงานผล
```

**เกณฑ์ผ่านเฟส:** unit test ทั้งหมดผ่าน โดยเฉพาะเทส noise-rejection และ tracker ต่อเนื่อง

---

## Phase 3: Full Video Processing Pipeline ด้วย Web Worker

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp เติมเนื้อหา src/workers/videoProcessing.worker.ts, src/lib/videoProcessor.ts, และ component ควบคุมการประมวลผล

บริบทสำคัญ: การดึงเฟรมจาก <video> element ต้องทำบน main thread เท่านั้น (DOM API เข้าถึงไม่ได้ใน worker โดยตรง) แต่การคำนวณหนัก (gradient, smoothing) ทำใน worker ได้
สถาปัตยกรรมที่ใช้: main thread ทำหน้าที่ seek วิดีโอทีละเฟรมแล้ว extract เป็น ImageData ส่งเข้า worker ผ่าน postMessage (ใช้ Transferable object หรือ structuredClone ของ ImageData เพื่อประสิทธิภาพ) worker คำนวณ findSurfaceEdge แล้วส่งผลกลับ

ส่วนที่ 1 — src/lib/videoProcessor.ts:

export interface ProcessingOptions {
  xColumn: number;
  columnWidth: number;
  searchMarginPx: number;
  smoothSigma: number;
  baselineY: number | null;   // ถ้า null ให้ auto-detect จาก 30 เฟรมแรก
  sampleRateHz: number;       // อัตราสุ่มเฟรม (ไม่พึ่งพา fps ที่แท้จริงของไฟล์วิดีโอเพราะ browser อ่านค่าไม่แน่นอน ให้ผู้ใช้กำหนดเอง เช่น 30Hz)
  onProgress?: (percent: number) => void;
}

export async function captureFrameAtTime(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeS: number
): Promise<ImageData>
- ตั้ง video.currentTime = timeS
- รอ event 'seeked' (wrap เป็น Promise, ใส่ timeout กันเคส seek ค้าง เช่น 3 วินาทีแล้ว reject)
- drawImage ลง canvas แล้วคืนค่า getImageData ของทั้งเฟรม (หรือเฉพาะ column ที่ต้องใช้เพื่อประหยัด memory — ถ้าทำได้ให้ getImageData เฉพาะแถบแคบ ๆ รอบ xColumn เท่านั้น ไม่ต้องทั้งเฟรม)

export async function processVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  calibration: CalibrationData,
  options: ProcessingOptions
): Promise<WaveDataPoint[]>
- คำนวณจำนวนเฟรมทั้งหมด = duration * sampleRateHz
- ถ้า baselineY เป็น null: capture 30 เฟรมแรก, หา surface ด้วย SurfaceTracker (เรียกตรงบน main thread ก็ได้เพราะแค่ 30 เฟรม ไม่ต้องพึ่ง worker), ใช้ median เป็น baseline
- สร้าง Web Worker instance จาก videoProcessing.worker.ts
- loop ตั้งแต่ t=0 ถึง duration step 1/sampleRateHz:
  - capture ImageData ที่ column บริเวณ xColumn ด้วย captureFrameAtTime
  - ส่ง ImageData + xColumn ตำแหน่งสัมพัทธ์ (ถ้า crop มาแล้วต้องปรับ index) เข้า worker ผ่าน postMessage
  - รอผลตอบกลับจาก worker (yPosition, confidence)
  - แปลง elevationCm = (baselineY - yPosition) / calibration.pixelsPerCm
  - เก็บ { timeS: t, elevationCm, confidence }
  - เรียก options.onProgress(percent) ทุกรอบเพื่ออัปเดต progress bar ใน UI
- terminate worker เมื่อเสร็จ, คืนค่า array WaveDataPoint[]

ส่วนที่ 2 — src/workers/videoProcessing.worker.ts:
- import findSurfaceEdge, extractColumnProfile จาก '../lib/surfaceDetector'
- รับ message จาก main thread รูปแบบ { imageData, xColumnRelative, columnWidth, searchRange, smoothSigma }
- เรียก extractColumnProfile + findSurfaceEdge แล้ว postMessage ผลกลับ { yPosition, confidence }
- ต้องรักษา state lastY ไว้ใน worker เองด้วย (เพราะ SurfaceTracker มี state) หรือส่ง lastY มาจาก main thread ทุกครั้งก็ได้ (เลือกวิธีที่ทำให้โค้ด clean กว่า และอธิบาย trade-off ในโค้ดเป็น comment)

ส่วนที่ 3 — src/components/ProcessingPanel.tsx:
- UI ให้ผู้ใช้กรอก xColumn (อาจให้คลิกเลือกบน canvas preview เฟรมแรกแทนการพิมพ์ตัวเลขก็ได้ ให้ใช้งานง่ายขึ้น), sampleRateHz, baselineY (optional)
- ปุ่ม "เริ่มประมวลผล" เรียก processVideo แสดง progress bar ระหว่างทำงาน (ใช้ onProgress callback อัปเดต React state)
- แสดงผลลัพธ์ WaveDataPoint[] เก็บใน state ส่งต่อให้เฟสถัดไปใช้พล็อตกราฟ

ผนวก component นี้เข้ากับ src/app/page.tsx ต่อจาก CalibrationCanvas (flow: อัปโหลด → calibrate → ตั้งค่าการประมวลผล → ประมวลผล → ผลลัพธ์)

เขียนเทสสำหรับส่วนที่เทสได้โดยไม่ต้องพึ่งวิดีโอจริง (src/lib/videoProcessor.test.ts):
- test ว่า captureFrameAtTime reject เมื่อ seek timeout (mock video element ที่ไม่ยิง event 'seeked' เลย)
- test structure/mock ของ processVideo ด้วย video element ปลอมที่ mock currentTime/duration (ไม่ต้องเทส accuracy ของการตรวจจับที่นี่ เพราะเทสนั้นทำใน Phase 2 แล้ว และจะทำ end-to-end จริงใน Phase 6)

รันเทสด้วย `npm run test` รายงานผล และทดสอบด้วยมือผ่าน `npm run dev` ว่า progress bar ทำงานจริงและ UI ไม่ค้างระหว่างประมวลผลวิดีโอยาว ๆ (ลองวิดีโอสัก 20-30 วินาที)
```

**เกณฑ์ผ่านเฟส:** unit test ที่เทสได้ผ่านหมด, ทดสอบด้วยมือว่า UI ไม่ freeze ระหว่างประมวลผล (นี่คือจุดสำคัญที่สุดของเฟสนี้ — ถ้า UI ค้างแปลว่า worker offload ไม่ทำงานจริง ต้องแก้ก่อนไปต่อ)

---

## Phase 4: Wave Statistics (Zero Up-Crossing Analysis)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp เติมเนื้อหา src/lib/waveStatistics.ts

พอร์ตตรรกะเดียวกับที่ใช้ในงานวิเคราะห์คลื่นทางวิศวกรรมชายฝั่งมาตรฐาน เป็น TypeScript pure functions:

export function detrend(elevationCm: number[]): number[]
- ลบค่าเฉลี่ยออกจากทุกจุด

export function zeroUpCrossingWaves(
  timeS: number[],
  elevationCm: number[]
): WaveEvent[]
- detrend สัญญาณก่อน
- หาตำแหน่งที่สัญญาณตัดผ่านศูนย์จากลบไปบวก (ค่าก่อนหน้า < 0 และค่าปัจจุบัน >= 0) ระหว่างจุดต่อเนื่องกันสองจุด
- ใช้ linear interpolation หาตำแหน่งเวลาที่ตัดศูนย์แม่นยำขึ้น (ไม่ใช้แค่ index ตรง ๆ เพราะ sample rate จำกัด)
- แต่ละคู่ zero-crossing ต่อเนื่องกัน = คลื่น 1 ลูก คำนวณ:
  - tStart, tEnd = เวลาที่ตัดศูนย์ต้น-ท้าย
  - periodS = tEnd - tStart
  - heightCm = max(elevation ในช่วงนั้น) - min(elevation ในช่วงนั้น)
- throw Error ถ้าตัดคลื่นได้น้อยกว่า 3 ลูก พร้อมข้อความอธิบายชัดเจน (สัญญาณสั้นเกินไปหรือไม่มีคลื่นชัดเจน)

export function computeWaveStatistics(
  timeS: number[],
  elevationCm: number[]
): WaveStatistics
- เรียก zeroUpCrossingWaves
- เรียง heightCm จากมากไปน้อย
- คำนวณ nWaves, hMax, hMean, hRms (root-mean-square), hSignificant (ค่าเฉลี่ยของ 1/3 คลื่นสูงสุด, ปัดจำนวนขึ้นถ้าหารไม่ลงตัว), periodMeanS, periodSignificantS (คาบเฉลี่ยเฉพาะกลุ่มคลื่นที่ใช้คำนวณ Hs)
- คืนค่า WaveStatistics ตาม interface ที่นิยามไว้ใน Phase 0 (รวม waves: WaveEvent[] ด้วย)

เขียน unit test ในไฟล์ src/lib/waveStatistics.test.ts:
- สร้างสัญญาณ sine wave บริสุทธิ์ (amplitude 10cm, period 2s, duration 60s, sample rate 30Hz) → ทุกคลื่นควรมีความสูงเท่ากันหมด (~20cm peak-to-peak, error ไม่เกิน 5%) และ periodMeanS ≈ 2s
- สร้างสัญญาณผสมสอง sine wave คนละ amplitude/period → hSignificant ต้อง >= hMean เสมอ และ hMax >= hSignificant >= hMean เสมอ
- test throw Error เมื่อสัญญาณสั้นเกินไป (คลื่นน้อยกว่า 3 ลูก)
- test zeroUpCrossingWaves ตรงกับที่คำนวณมือได้ในเคสง่าย ๆ (สัญญาณสามเหลี่ยมสั้น ๆ ที่รู้จุดตัดศูนย์แน่นอน)

รันเทสด้วย `npm run test` รายงานผล
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด โดยเฉพาะเทส sine wave บริสุทธิ์ error ต้องไม่เกิน 5%

---

## Phase 5: Visualization และ CSV Export

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp เติมเนื้อหา src/lib/csvExport.ts และสร้าง components สำหรับแสดงผล

ส่วนที่ 1 — src/lib/csvExport.ts:

export function waveDataToCSV(data: WaveDataPoint[]): string
- แปลง array เป็น CSV string (header: time_s,elevation_cm,confidence)

export function downloadCSV(csvContent: string, filename: string): void
- สร้าง Blob จาก csvContent, สร้าง object URL, สร้าง <a> element ชั่วคราวคลิก download แล้วลบทิ้ง (มาตรฐานวิธี trigger download ไฟล์ในเบราว์เซอร์โดยไม่ต้องพึ่ง backend)
- revoke object URL หลังใช้เพื่อกัน memory leak

ส่วนที่ 2 — src/components/ElevationChart.tsx:
- ใช้ recharts (LineChart) พล็อต timeS (แกน x) vs elevationCm (แกน y)
- แสดงเส้นอ้างอิง baseline ที่ y=0 (ReferenceLine)
- responsive container ให้ปรับขนาดตามหน้าจอ
- แสดง tooltip เมื่อ hover บอกค่า time/elevation ตรงจุด

ส่วนที่ 3 — src/components/WaveHeightHistogram.tsx:
- ใช้ recharts (BarChart) แสดง histogram ของ heightCm จาก waves array (ต้อง bin ข้อมูลเองก่อนส่งเข้า BarChart เพราะ recharts ไม่มี histogram builtin — เขียนฟังก์ชัน binning ง่าย ๆ แบ่งเป็น 15 ช่วงเท่า ๆ กันระหว่าง min-max)
- แสดงเส้นแนวตั้ง (ReferenceLine) ที่ตำแหน่ง hMean และ hSignificant พร้อม label

ส่วนที่ 4 — src/components/ResultsSummary.tsx:
- แสดงตัวเลขสรุปสถิติทั้งหมด (nWaves, hMax, hMean, hSignificant, periodMeanS) เป็นการ์ดตัวเลขใหญ่ ๆ อ่านง่าย ใช้ Tailwind grid layout
- ปุ่ม "ดาวน์โหลด CSV ข้อมูลดิบ" เรียก downloadCSV
- ปุ่ม "ดาวน์โหลดรายงานสรุป" ที่สร้างไฟล์ .txt หรือ .md ง่าย ๆ ที่มีตัวเลขสถิติทั้งหมด (ใช้กลไก download เดียวกับ CSV)

ผนวกทุก component เข้ากับ src/app/page.tsx เป็นขั้นตอนสุดท้ายของ flow (อัปโหลด → calibrate → ตั้งค่า → ประมวลผล → **ผลลัพธ์**)

เขียน component test เบื้องต้นด้วย @testing-library/react ในไฟล์ src/components/ResultsSummary.test.tsx:
- render ResultsSummary ด้วย mock WaveStatistics แล้วตรวจว่าตัวเลขสถิติแสดงถูกต้องในหน้าจอ (screen.getByText)
- ตรวจว่าปุ่มดาวน์โหลดมีอยู่จริงและ clickable

รันเทสด้วย `npm run test` รายงานผล และรัน `npm run build` อีกครั้งให้แน่ใจว่ายัง build ผ่าน
```

**เกณฑ์ผ่านเฟส:** unit + component test ผ่านทั้งหมด, `npm run build` ผ่าน, ทดสอบด้วยมือว่ากราฟแสดงผลถูกต้องสวยงาม, ดาวน์โหลด CSV ได้จริง

---

## Phase 6: End-to-End Testing (วิดีโอสังเคราะห์) และ Deploy บน Vercel

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp

ส่วนที่ 1 — สร้างสคริปต์ generate วิดีโอทดสอบ:
เขียนสคริปต์ Node.js (scripts/generate-test-video.mjs) ที่ใช้ canvas (ติดตั้ง npm package "canvas" หรือ "@napi-rs/canvas") วาดเฟรมทีละภาพเป็นรอยต่อสว่าง/มืดขยับตาม sine wave ที่กำหนด amplitude/period ได้ แล้วเข้ารหัสเป็นวิดีโอ .webm หรือ .mp4 (ถ้าไม่มี ffmpeg binding ใน Node ให้ fallback เป็นการสร้างชุดภาพ PNG แล้วแนะนำคำสั่ง ffmpeg command-line ต่อภาพเป็นวิดีโอแทน เพราะการ encode วิดีโอใน pure Node.js ค่อนข้างซับซ้อน — อธิบายเหตุผลของทางเลือกที่ใช้ให้ชัดเจนในโค้ด comment)
รับ arguments ผ่าน command line: --amplitude-px, --period-s, --duration-s, --fps, --width, --height, --output

ส่วนที่ 2 — เทส end-to-end ด้วย Playwright:
ติดตั้ง @playwright/test
เขียนเทสในไฟล์ e2e/wave-analysis.spec.ts:
- เปิดหน้าเว็บ (npm run dev รันคู่กับเทส หรือ build แล้ว serve static ก่อนรันเทส)
- อัปโหลดวิดีโอทดสอบที่ generate ไว้ (ใช้ page.setInputFiles)
- จำลองการคลิก calibrate 2 จุดบน canvas ที่ตำแหน่งรู้ค่าแน่นอน (คำนวณ pixelsPerCm ที่คาดหวังไว้ล่วงหน้าเพื่อเทียบผล)
- กรอกค่า xColumn, sampleRateHz แล้วกดเริ่มประมวลผล
- รอจน progress bar เสร็จ (รอ element ผลลัพธ์ปรากฏ, ตั้ง timeout ให้เหมาะกับความยาววิดีโอทดสอบ)
- ตรวจว่าค่า hSignificant ที่แสดงบนหน้าจอใกล้เคียงกับค่าที่คำนวณไว้ล่วงหน้าจาก amplitude ที่ตั้งตอน generate วิดีโอ (2 * amplitudePx / pixelsPerCm, error ไม่เกิน 15%)
- ตรวจว่าปุ่มดาวน์โหลด CSV ทำงานได้จริง (ตรวจ download event ของ Playwright)

ส่วนที่ 3 — เตรียม Deploy บน Vercel:
- ตรวจสอบว่าไม่มีการใช้ Node.js-only API ใด ๆ หลุดเข้าไปใน client component (เช่น require('fs')) เพราะจะพังตอน build บน Vercel
- ตรวจสอบว่า Web Worker ทำงานถูกต้องหลัง build production (`npm run build && npm run start` แล้วทดสอบด้วยมืออีกครั้ง เพราะ dev mode กับ production build บางทีจัดการ worker ต่างกัน)
- เพิ่มไฟล์ .env.example ถ้ามี environment variable ใด ๆ (กรณีนี้ไม่น่ามีเพราะไม่มี backend แต่เผื่อไว้)
- เขียนขั้นตอน deploy ใน README.md: ติดตั้ง Vercel CLI (`npm i -g vercel`), รัน `vercel login`, รัน `vercel` เพื่อ deploy preview, รัน `vercel --prod` เพื่อ deploy production
- ถ้ามี Vercel CLI พร้อมใช้งานในสภาพแวดล้อมนี้และมีการ login ไว้แล้ว ให้ลอง deploy จริงแล้วรายงาน URL ที่ได้ ถ้าไม่มีสิทธิ์ deploy ในสภาพแวดล้อมนี้ ให้หยุดแค่ยืนยันว่า build ผ่านสมบูรณ์และสรุปขั้นตอนที่เหลือให้ผู้ใช้ทำเองบนเครื่อง

รันชุดเทสทั้งหมด (`npm run test` และ `npx playwright test`) รายงานผลว่าผ่านกี่ข้อ มีข้อไหน fail อธิบายเหตุผล
```

**เกณฑ์ผ่านเฟส:** unit test + component test + e2e test ผ่านทั้งหมด, `npm run build` ผ่านบน production mode, ทดสอบ deploy preview บน Vercel ได้จริง (หรืออย่างน้อย build พร้อม deploy 100%)

---

## Phase 7: Multi-Point Measurement (วัดหลายตำแหน่งพร้อมกัน)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 6) เพิ่มความสามารถวัดผิวน้ำได้หลายตำแหน่ง x พร้อมกันในเฟรมเดียว
เช่น ใช้เทียบระดับน้ำหลายจุดตามแนวราง wave flume (ต้นทาง-กลางทาง-ปลายทางของราง)

ส่วนที่ 1 — แก้ src/types/wave.ts เพิ่ม type ใหม่ (ไม่ลบของเดิม แก้ตรงที่จำเป็น):

interface MeasurementPoint {
  id: string;          // uuid หรือ nanoid สั้น ๆ
  xColumn: number;
  label: string;        // ชื่อที่ผู้ใช้กำหนด เช่น "จุดที่ 1 - ต้นราง"
  color: string;        // hex color สำหรับแยกสีในกราฟ/overlay
  baselineY: number | null;
}

แก้ ProcessingOptions ให้รับ points: MeasurementPoint[] แทน xColumn เดี่ยว
แก้ WaveDataPoint หรือเพิ่ม type ใหม่:

interface MultiPointWaveData {
  pointId: string;
  data: WaveDataPoint[];
}

ส่วนที่ 2 — แก้ src/components/CalibrationCanvas.tsx (หรือแยก component ใหม่ src/components/PointSelector.tsx ถ้าทำให้โค้ดชัดเจนกว่า):
- เปลี่ยนจากคลิกเลือก x column เดียว เป็นคลิกเพิ่มได้หลายจุดบน canvas (แต่ละคลิกสร้าง MeasurementPoint ใหม่)
- แสดงรายการจุดที่เลือกไว้เป็น list ด้านข้าง canvas พร้อม: color swatch, input text ให้แก้ label, ปุ่มลบจุดนั้น
- วาดเส้นแนวตั้งสีตามจุดนั้นทับบน canvas preview ที่ตำแหน่ง xColumn ของแต่ละจุด ให้เห็นตำแหน่งที่จะวัดชัดเจนก่อนเริ่มประมวลผลจริง
- แจก default color อัตโนมัติจาก palette ที่กำหนดไว้ (เช่น ['#3b82f6','#ef4444','#22c55e','#f59e0b','#a855f7', ...]) ไม่ให้ผู้ใช้ต้องเลือกสีเองทุกจุด (แก้ทีหลังได้)
- จำกัดจำนวนจุดสูงสุดไว้พอสมควร (เช่น 8 จุด) ป้องกัน UI รก และ performance ตกมากเกินไป — ใส่ validation แจ้งเตือนถ้าเกิน

ส่วนที่ 3 — แก้ src/workers/videoProcessing.worker.ts:
- แก้ message format ให้รับ points array พร้อม imageData ของแต่ละเฟรม
- ใน worker loop คำนวณ extractColumnProfile + findSurfaceEdge สำหรับทุกจุดใน points array ภายใน message เดียวกัน (ลด overhead การส่ง message ไป-กลับ ถ้าต้องทำทีละจุดจะช้ากว่ามาก)
- เก็บ SurfaceTracker แยกอินสแตนซ์ต่อ point (ใช้ Map<pointId, SurfaceTracker> ใน worker เพื่อให้แต่ละจุดมี lastY ของตัวเองไม่ปนกัน)
- คืนค่าเป็น array ของ { pointId, yPosition, confidence } ต่อเฟรม

ส่วนที่ 4 — แก้ src/lib/videoProcessor.ts:
- แก้ processVideo ให้ crop ImageData ครอบคลุมทุก xColumn ของทุกจุดในครั้งเดียว (ไม่ crop แยกทีละจุด) แล้วส่งเข้า worker ครั้งเดียวต่อเฟรม พร้อมพิกัด offset ที่ปรับ index ให้ worker คำนวณตำแหน่งสัมพัทธ์ของแต่ละจุดถูกต้อง
- ถ้า auto-baseline: ทำแยกต่อจุด (แต่ละจุดมี baselineY ของตัวเอง เพราะระดับน้ำนิ่งอาจต่างกันเล็กน้อยตามตำแหน่งในราง เช่น มีความชันเล็กน้อย)
- คืนค่าเป็น Record<string, WaveDataPoint[]> (key = pointId)

ส่วนที่ 5 — แก้ src/components/ElevationChart.tsx:
- แสดงหลาย <Line> ในกราฟเดียว (multi-series overlay) สีตาม MeasurementPoint.color ของแต่ละจุด พร้อม legend แสดง label
- เพิ่ม toggle ให้ซ่อน/แสดงเส้นแต่ละจุดได้ (คลิกที่ legend เพื่อ toggle ตาม pattern ปกติของ recharts)

ส่วนที่ 6 — แก้ src/components/ResultsSummary.tsx:
- เปลี่ยนจากแสดงสถิติจุดเดียว เป็นตารางเปรียบเทียบ (label, hSignificant, hMax, hMean, periodMeanS) หนึ่งแถวต่อจุด
- ปุ่มดาวน์โหลด CSV ต้องดาวน์โหลดได้ทั้งแบบรวมทุกจุดในไฟล์เดียว (คอลัมน์แยกตามจุด) และแบบเลือกดาวน์โหลดเฉพาะจุดเดียว

เขียน/แก้ unit test:
- src/lib/videoProcessor.test.ts: test ว่า cropping ครอบคลุมทุก xColumn ถูกต้องเมื่อจุดกระจายอยู่ห่างกันมาก (เช่นจุดที่ 1 อยู่ x=50 จุดที่ 2 อยู่ x=800 ในภาพกว้าง 1000px) — ตรวจว่า offset ที่ส่งให้ worker คำนวณตำแหน่งสัมพัทธ์กลับมาตรงกับตำแหน่งจริงในภาพต้นฉบับ
- src/lib/surfaceDetector.test.ts (แก้เพิ่ม): test ว่า Map<pointId, SurfaceTracker> ใน worker ไม่ทำให้ point หนึ่งไปรบกวน lastY ของอีก point (สร้างสองจุดที่ตำแหน่งรอยต่อขยับคนละทิศทาง ตรวจว่าแต่ละจุด track ถูกต้องเป็นอิสระจากกัน)
- component test สำหรับ point selector: เพิ่มจุด, ลบจุด, แก้ label, ตรวจ validation เมื่อเกินจำนวนจุดสูงสุด

รันเทสด้วย `npm run test` และทดสอบด้วยมือ (`npm run dev`) ด้วยวิดีโอที่มีรอยต่อ 2-3 จุดขยับคนละคาบ/amplitude เพื่อยืนยันว่าแต่ละจุดวัดค่าถูกต้องแยกจากกันจริง
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด, ทดสอบด้วยมือว่าเลือกได้หลายจุด กราฟแสดงหลายเส้นถูกต้อง และตารางเปรียบเทียบสถิติแยกตามจุดถูกต้อง

---

## Phase 8: GUI Live Viewer (Overlay ตำแหน่งผิวน้ำแบบ Real-time ระหว่างประมวลผล)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 7) เพิ่มหน้าต่างแสดงวิดีโอพร้อม overlay ตำแหน่งที่ detect ได้ real-time เพื่อ debug ด้วยตาว่าระบบตรวจจับผิวน้ำถูกต้องหรือไม่ ก่อนเชื่อผลลัพธ์ตัวเลข

ข้อสังเกตสำคัญ: จาก Phase 3 เราวาดวิดีโอลง canvas อยู่แล้วก่อน getImageData (ใน captureFrameAtTime) ดังนั้นสามารถใช้ canvas เดียวกันนี้เป็น preview ที่มองเห็นได้ ไม่ต้องวาดซ้ำสองรอบ — แค่ทำให้ canvas นั้น visible ในหน้าจอ (ไม่ต้อง display:none) แล้ว overlay เพิ่มด้วย canvas อีกชั้นทับด้านบน (position: absolute) วาดแค่ marker/เส้น ไม่วาดภาพวิดีโอซ้ำ (แยก layer เพื่อ clear/redraw overlay ได้เร็วโดยไม่ต้อง draw ภาพวิดีโอใหม่ทุกครั้ง)

ส่วนที่ 1 — src/components/LiveViewerCanvas.tsx:
- รับ videoCanvasRef (canvas ที่มีภาพเฟรมปัจจุบันอยู่แล้วจาก pipeline) มาแสดงผล
- สร้าง overlay canvas ขนาดเท่ากัน วางทับด้วย CSS position absolute
- รับ prop currentDetections: Array<{ pointId, xColumn, yPosition, confidence, color }> อัปเดตทุกเฟรมที่ประมวลผลเสร็จ
- วาดบน overlay canvas: จุดวงกลมสีตาม MeasurementPoint.color ที่ตำแหน่ง (xColumn, yPosition) ของทุกจุด, เส้นแนวตั้งจางๆที่ xColumn แต่ละจุดตลอดความสูงภาพ (ให้เห็นว่ากำลังวัดที่ตำแหน่งไหน), เส้นแนวนอนที่ baselineY ของแต่ละจุด (สีจางกว่าจุด detect)
- แสดงตัวเลข confidence เป็นข้อความเล็ก ๆ ข้างจุดแต่ละจุด (ช่วยดูว่าเฟรมไหน confidence ต่ำผิดปกติ น่าสงสัยว่า detect ผิด)
- ล้าง (clearRect) overlay canvas ก่อนวาดใหม่ทุกเฟรม เพื่อไม่ให้ marker เก่าค้าง

ส่วนที่ 2 — src/components/ProcessingControls.tsx:
- เพิ่มปุ่ม "หยุดชั่วคราว" / "ทำต่อ" (pause/resume) ระหว่างประมวลผล — ทำได้โดยเพิ่ม flag isPaused ใน state ที่ loop การประมวลผลใน videoProcessor.ts ตรวจสอบก่อนไปเฟรมถัดไป (ใช้ Promise ที่ resolve เมื่อ isPaused กลับเป็น false อีกครั้ง, poll ด้วย small delay loop หรือใช้ event-based mechanism ก็ได้)
- เพิ่ม checkbox "โหมด Debug (แสดงผลช้าลงเพื่อดูรายละเอียด)" — ถ้าเปิดไว้ ให้เพิ่ม delay เล็กน้อย (เช่น await ด้วย setTimeout 50-100ms) ระหว่างเฟรมในโหมดนี้เท่านั้น เพื่อให้ตาดูทันจริง ๆ (ปิดโหมดนี้ไว้เป็น default เพราะทำให้ประมวลผลช้ากว่าปกติมาก)
- เพิ่ม slider หรือ input "แสดงผล overlay ทุก N เฟรม" (ไม่ต้อง render overlay ทุกเฟรมถ้า sample rate สูงมาก จะทำให้ browser render ช้าโดยไม่จำเป็น เพราะตาเรามองไม่ทันอยู่ดี — default อาจเป็นทุกเฟรมถ้า sample rate ต่ำ หรือทุก 2-3 เฟรมถ้าสูง)

ส่วนที่ 3 — แก้ src/lib/videoProcessor.ts:
- เพิ่ม parameter onFrameProcessed?: (detections: DetectionResult[], frameImageCanvas: HTMLCanvasElement) => void ใน ProcessingOptions เรียก callback นี้หลังประมวลผลแต่ละเฟรมเสร็จ (หรือทุก N เฟรมตามที่ตั้งค่าไว้) ส่งข้อมูลขึ้นไปให้ LiveViewerCanvas วาด
- เพิ่ม parameter isPausedRef: { current: boolean } หรือกลไกเทียบเท่า ให้ loop หลักตรวจสอบก่อนไปเฟรมถัดไปเพื่อรองรับปุ่ม pause/resume

ผนวก LiveViewerCanvas และ ProcessingControls เข้ากับ src/app/page.tsx ให้แสดงระหว่างขั้นตอนประมวลผล (ก่อนหน้านี้มีแค่ progress bar เฉย ๆ ตอนนี้เห็นวิดีโอ+overlay จริงด้วย)

เขียนเทส:
- src/lib/videoProcessor.test.ts (แก้เพิ่ม): test pause/resume mechanism ด้วย mock loop สั้น ๆ ตรวจว่า loop ค้างรอจริงตอน isPaused=true และไปต่อได้เมื่อกลับเป็น false
- component test สำหรับ LiveViewerCanvas: mock currentDetections แล้วตรวจว่า overlay canvas มีการเรียก drawing API ที่ถูกต้อง (mock canvas context ด้วย vitest, ตรวจว่า arc()/moveTo()/lineTo() ถูกเรียกด้วยพารามิเตอร์ที่คาดหวัง)

รันเทสด้วย `npm run test` และทดสอบด้วยมือ (`npm run dev`) เปิดโหมด Debug ดูว่า overlay ตามตำแหน่งผิวน้ำได้แม่นยำจริงด้วยตา ทดลองกดปุ่ม pause/resume ระหว่างประมวลผลว่าทำงานถูกต้อง
```

**เกณฑ์ผ่านเฟส:** เทสผ่านทั้งหมด, ทดสอบด้วยมือเปิดโหมด Debug แล้ว "เห็นจุด overlay เกาะตามผิวน้ำได้จริง" ด้วยตา — นี่คือเกณฑ์เชิงคุณภาพที่สำคัญที่สุดของเฟสนี้ เพราะจุดประสงค์หลักคือช่วยให้ผู้ใช้เชื่อผลลัพธ์ตัวเลขได้

---

## Phase 9: Ruler-Based Continuous Re-calibration (แก้ทั้งกล้องเลื่อนตำแหน่งและซูมเข้า-ออก)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 8) เพิ่มระบบ re-calibrate ค่า pixels/cm และตำแหน่งจุดวัดใหม่อัตโนมัติทุก ๆ N เฟรม โดยอ่านขีดสเกลบนไม้บรรทัดที่อยู่ในเฟรมจริง (ไม่ใช่ template matching จุด marker เฉย ๆ)

บริบทสำคัญ (ต่างจาก Phase 9 เวอร์ชันแรกที่เคยออกแบบไว้): กรณีใช้งานจริงคือถ่ายมือถือ ไม่ได้ตั้งขาตั้งกล้อง กล้องขยับทั้งเลื่อนตำแหน่งและหมุน/เอียง ที่สำคัญคือ**กล้องเข้าใกล้-ถอยห่างจากไม้บรรทัดจริง** ทำให้ขนาดไม้บรรทัดในภาพเปลี่ยนไปตลอด (pixels/cm ไม่คงที่) — การ track แค่ offset ตำแหน่ง (dx, dy) แบบเดิมแก้ปัญหานี้ไม่ได้ เพราะไม่ได้แก้เรื่องสเกลเปลี่ยน จึงต้อง**อ่านขีดบนไม้บรรทัดใหม่ทุกครั้ง**แทน ซึ่งแก้ได้ทั้งเลื่อนตำแหน่งและซูมพร้อมกันในคราวเดียว เพราะเป็นการวัดค่าจริงจากวัตถุอ้างอิงโดยตรง ไม่ใช่การเดา transform ของกล้อง

หลักการออกแบบที่เปลี่ยนไปจากเฟสก่อนหน้า: **MeasurementPoint จะไม่ผูกกับตำแหน่งพิกเซลตายตัวอีกต่อไป** แต่ผูกกับ "ค่าจริงบนไม้บรรทัด" แทน (เช่น baseline = ขีด 25cm, จุดวัดอยู่ห่างไม้บรรทัดไปทางขวา 40cm) แล้วแปลงกลับเป็นพิกเซลใหม่ทุกครั้งที่ re-calibrate

ส่วนที่ 1 — แก้ src/types/wave.ts:

interface RulerCalibration {
  point1: { x: number; y: number; valueCm: number };  // คลิกขีดที่ 1 พร้อมค่าจริงที่อ่านได้ เช่น {x:500,y:120,valueCm:30}
  point2: { x: number; y: number; valueCm: number };   // คลิกขีดที่ 2 พร้อมค่าจริง
  roi: { x: number; y: number; width: number; height: number };  // กรอบสี่เหลี่ยมครอบไม้บรรทัดสำหรับค้นหาขีดทุกเฟรม (ให้กว้างกว่าตัวไม้บรรทัดเล็กน้อยเผื่อกล้องเลื่อน/ซูม)
}

แก้ MeasurementPoint (จาก Phase 7) เพิ่ม field:
  baselineValueCm: number | null;   // ค่าจริงบนไม้บรรทัดที่ตรงกับระดับน้ำนิ่ง (ถ้า null ให้ auto-detect เหมือนเดิมจาก 30 เฟรมแรกแล้วแปลงเป็น valueCm ด้วย calibration ตอนนั้น)
  xOffsetCm: number;                 // ระยะห่างแนวนอนจากตำแหน่งไม้บรรทัด (บวก = ขวา, ลบ = ซ้าย) แทนที่การ hardcode เป็น xColumn ตายตัว

ส่วนที่ 2 — src/lib/rulerTracker.ts:

export function extractRulerProfile(imageData: ImageData, roi: {x,y,width,height}): Float32Array
- เฉลี่ยความสว่าง (grayscale) ตามแนวแกนยาวของไม้บรรทัดภายใน roi (ถ้าไม้บรรทัดแนวตั้ง เฉลี่ยตามแนว y เหมือน extractColumnProfile จาก Phase 2 แต่จำกัดเฉพาะในกรอบ roi)

export interface TickPeak { pixelPos: number; strength: number; }

export function detectTickPeaks(profile: Float32Array, smoothSigma: number = 1.5): TickPeak[]
- reuse gaussianSmooth1D และ computeGradient จาก Phase 2 (surfaceDetector.ts) — import มาใช้ซ้ำ ไม่ copy โค้ด
- หา local maxima ของ |gradient| ที่สูงกว่า threshold (เช่น mean + 1*std ของสัญญาณ) = ตำแหน่งขีดที่เป็นไปได้แต่ละขีด
- คืนค่า array ของ TickPeak เรียงตาม pixelPos

export interface RulerFit { pixelsPerCm: number; anchorPixelPos: number; anchorValueCm: number; fitError: number; }

export function fitUniformGrid(
  peaks: TickPeak[],
  priorPixelsPerCm: number,
  priorAnchorPixelPos: number,
  priorAnchorValueCm: number,
  cmPerTick: number
): RulerFit
- ใช้ priorPixelsPerCm เป็นค่าตั้งต้นในการคาดเดาว่า peak แต่ละตัวควรอยู่ห่างกันกี่พิกเซล (= cmPerTick * priorPixelsPerCm)
- จับคู่ peaks ที่ตรวจเจอกับตำแหน่งบนกริดสม่ำเสมอที่คาดไว้ (ให้แต่ละ peak มี "ลำดับขีด" i เทียบกับ anchor โดยหาค่า i ที่ทำให้ตำแหน่งที่คาดไว้ (priorAnchorPixelPos + i*cmPerTick*priorPixelsPerCm) ใกล้เคียงตำแหน่งจริงของ peak นั้นที่สุด)
- ทำ linear regression (least squares) ระหว่างลำดับขีด i กับตำแหน่งพิกเซลจริงของแต่ละ peak ที่จับคู่ได้ → ได้ pixelsPerCm และ anchorPixelPos ที่แม่นยำขึ้นของเฟรมนี้
- คำนวณ fitError (เช่น RMS ของ residual การ fit) ใช้บอก confidence ของการ re-calibrate ครั้งนี้
- คืนค่า RulerFit — ถ้า fitError สูงเกิน threshold ที่กำหนด (สัญญาณว่าน่าจะ fit ผิดขีด/สับสน) ให้ผู้เรียกใช้ (RulerCalibrationTracker) เลือกไม่อัปเดตค่าและใช้ค่าเดิมต่อ

export class RulerCalibrationTracker {
  constructor(
    private initialCalibration: RulerCalibration,
    private cmPerTick: number,
    private checkIntervalFrames: number = 10,   // ถี่กว่า Phase 9 เวอร์ชันก่อน เพราะซูมกล้องเปลี่ยนต่อเนื่องระหว่างเฟรมได้เร็วกว่าการสั่นเฉย ๆ
    private maxFitError: number = 2.0
  ) {
    // คำนวณ priorPixelsPerCm, priorAnchorPixelPos, priorAnchorValueCm เริ่มต้นจาก initialCalibration.point1/point2
  }

  private frameCounter = 0
  private currentFit: RulerFit  // ค่าปัจจุบันที่ใช้อยู่ อัปเดตเมื่อ fit ผ่านเกณฑ์เท่านั้น
  private currentRulerCenterX: number  // ตำแหน่ง x ปัจจุบันของไม้บรรทัด (ใช้เป็น anchor คำนวณ xOffsetCm)

  shouldCheck(): boolean
  update(imageData: ImageData): RulerFit
  - เรียก extractRulerProfile + detectTickPeaks + fitUniformGrid ด้วย currentFit เป็น prior (ไม่ใช่ initial calibration เฉย ๆ เพื่อ track การเปลี่ยนแปลงต่อเนื่องเป็นทอด ๆ)
  - ถ้า fitError ผ่านเกณฑ์: อัปเดต currentFit แล้วคืนค่าใหม่
  - ถ้าไม่ผ่าน: คืนค่า currentFit เดิม (ไม่อัปเดต) พร้อม log คำเตือนว่า re-calibrate รอบนี้ไม่น่าเชื่อถือ

  valueCmToPixelY(valueCm: number): number
  - แปลงค่าจริง (cm) เป็นตำแหน่งพิกเซล y โดยใช้ currentFit ปัจจุบัน (สูตร: anchorPixelPos - (valueCm - anchorValueCm) * pixelsPerCm หรือทิศทางตรงข้ามแล้วแต่ทิศของแกน y ในภาพ — ให้ระบุ comment ชัดเจนว่า assume แกนไหนคือทิศเพิ่มขึ้นของค่า)

  pixelXForOffset(offsetCm: number): number
  - แปลงระยะห่างแนวนอนจากไม้บรรทัด (cm) เป็นตำแหน่งพิกเซล x โดยใช้ currentRulerCenterX + offsetCm * currentFit.pixelsPerCm (สมมติ pixels/cm เท่ากันทั้งแนวตั้งแนวนอน เพราะวิดีโอผ่านการแก้ fisheye เป็น Linear/rectilinear แล้วจาก Insta360 ตามที่ผู้ใช้ทำไว้ก่อนอัปโหลดเข้าระบบนี้)

ส่วนที่ 3 — UI: src/components/RulerCalibrationPanel.tsx (แทนที่/ต่อยอด CalibrationCanvas จาก Phase 1):
- ให้ผู้ใช้วาดกรอบสี่เหลี่ยม (drag บน canvas) ครอบไม้บรรทัดทั้งเส้นที่มองเห็นในเฟรม → ได้ roi
- ให้คลิก 2 ขีดบนไม้บรรทัดภายในกรอบนั้น แล้วกรอกค่าจริง (valueCm) ของแต่ละขีดที่คลิก (ไม่ใช่กรอกแค่ระยะห่าง เหมือน Phase 1 เดิม — ต้องกรอกค่าที่ขีดนั้นจริง ๆ เพราะต้องใช้เป็น absolute reference ไม่ใช่แค่ระยะสัมพัทธ์)
- input "ระยะห่างระหว่างขีดย่อยแต่ละขีด (cm)" (cmPerTick) เพื่อให้ fitUniformGrid รู้ว่าขีดที่เห็นถี่ ๆ แต่ละอันห่างกันกี่ cm จริง (เช่น 1 cm/ขีด)
- สำหรับแต่ละ MeasurementPoint (ต่อจาก Phase 7): เปลี่ยน input จาก "xColumn พิกเซล" เป็น "ระยะห่างจากไม้บรรทัด (cm)" และ baseline จาก "พิกเซล y" เป็น "อ่านค่าบนไม้บรรทัดตรงระดับน้ำนิ่ง (cm)" — ถ้าไม่ทราบให้ปล่อยว่างใช้ auto-detect เหมือนเดิม (ระบบจะแปลงเป็น valueCm ให้เองจากตำแหน่งพิกเซลที่ auto-detect ได้ผ่าน calibration ปัจจุบัน)

ส่วนที่ 4 — แก้ src/lib/videoProcessor.ts:
- สร้าง RulerCalibrationTracker instance จาก RulerCalibration ที่ได้จาก UI
- ในลูปประมวลผลแต่ละเฟรม: เรียก tracker.shouldCheck() ก่อน ถ้าจริงให้ getImageData บริเวณ roi (crop เฉพาะกรอบไม้บรรทัด ไม่ต้องทั้งเฟรม เพื่อประหยัด) แล้วเรียก tracker.update()
- ก่อนส่งงานเข้า worker ของแต่ละเฟรม: คำนวณ xColumn และ baselineY ปัจจุบันของทุก MeasurementPoint จาก tracker.pixelXForOffset(point.xOffsetCm) และ tracker.valueCmToPixelY(point.baselineValueCm) แล้วค่อยส่งพิกัดพิกเซลเหล่านี้เข้า worker เหมือนเฟสก่อน ๆ (worker เองไม่ต้องรู้เรื่อง ruler tracking เลย รับแค่พิกัดพิกเซลที่คำนวณมาให้แล้ว)
- ส่งค่า currentFit.pixelsPerCm ปัจจุบันขึ้นไปให้ LiveViewerCanvas (จาก Phase 8) แสดงเป็นตัวเลข debug เช่น "Scale: 12.3 px/cm" อัปเดตทุกครั้งที่ re-calibrate เพื่อให้ผู้ใช้เห็นว่าระบบกำลังปรับสเกลตามจริงมั้ย

เขียน unit test ในไฟล์ src/lib/rulerTracker.test.ts:
- สร้าง ImageData ปลอมที่มีลายขีดสม่ำเสมอ (จำลองไม้บรรทัด: แถบมืด-สว่างสลับกันเป็นคาบ ระยะห่างคงที่ตาม pixelsPerCm ที่ตั้งไว้ เช่น 20px ต่อขีด) → test detectTickPeaks เจอจำนวนขีดและตำแหน่งถูกต้อง (error ไม่เกิน 2px ต่อขีด)
- test fitUniformGrid กับ peaks ที่สร้างจากค่า pixelsPerCm ที่รู้ค่าแน่นอน → ได้ pixelsPerCm ที่ fit กลับมาตรงกับค่าจริง (error ไม่เกิน 3%)
- **เทสสำคัญที่สุดของเฟสนี้**: สร้างชุดภาพจำลอง "กล้องซูมเข้า" ต่อเนื่อง (ขีดเดิมแต่ pixelsPerCm เพิ่มขึ้นทีละน้อยทุกเฟรม จำลองกล้องเข้าใกล้ไม้บรรทัด) → test ว่า RulerCalibrationTracker.update() ที่เรียกต่อเนื่องหลายเฟรม ตามการเปลี่ยนแปลงของ pixelsPerCm ได้ต่อเนื่องไม่หลุดล็อก (ไม่ jump ไปนับขีดผิดตัว) ตลอดช่วงซูมที่จำลอง
- test ว่าเมื่อ peaks สับสน/nose สูงผิดปกติ (fitError เกิน threshold) ค่า currentFit ไม่ถูกอัปเดต (ยังคงใช้ค่าก่อนหน้าต่อ)
- test valueCmToPixelY และ pixelXForOffset ให้ผลตรงกับที่คำนวณมือได้ในเคสง่าย ๆ

รันเทสด้วย `npm run test` และทดสอบด้วยมือ: generate วิดีโอทดสอบที่จำลองกล้องซูมเข้า-ออกต่อเนื่อง (ไม้บรรทัดขยายขนาดขึ้น-ลงในเฟรมตามฟังก์ชันที่กำหนดได้) พร้อมคลื่น sine wave ที่รู้ amplitude แน่นอน ประมวลผลทั้งแบบเปิด/ปิด ruler re-calibration เทียบกันว่าเปิดแล้วค่า hSignificant ที่วัดได้ใกล้เคียงค่าจริงมากกว่าปิดจริง (ตอนปิดควรเห็นค่าคลาดเคลื่อนไปตามการซูม ตอนเปิดควรใกล้เคียงค่าจริงตลอด)
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด โดยเฉพาะเทส "กล้องซูมต่อเนื่อง" ที่ต้องตามสเกลได้โดยไม่หลุดล็อก, ทดสอบด้วยมือเทียบเปิด/ปิดฟีเจอร์กับวิดีโอซูมจำลองแล้วเห็นความแม่นยำต่างกันชัดเจน — ถ้าเปิดฟีเจอร์แล้วผลไม่ดีขึ้น ต้องกลับไปตรวจว่า videoProcessor.ts คำนวณ xColumn/baselineY จาก tracker ใหม่ทุกเฟรมจริงหรือยังใช้ค่าเดิมค้างอยู่

---

## Phase 10: Batch Processing (ประมวลผลหลายวิดีโอต่อกันจาก Config)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 9) เพิ่มความสามารถประมวลผลวิดีโอหลายไฟล์ต่อกันอัตโนมัติ พร้อม config กำหนดค่าต่อไฟล์ได้

บริบท: เพราะรันในเบราว์เซอร์ไม่มี backend การ "batch" หมายถึงผู้ใช้เลือกไฟล์วิดีโอหลายไฟล์พร้อมกันในเครื่องตัวเอง (ผ่าน input multiple) แล้วระบบประมวลผลทีละไฟล์ต่อเนื่องกันอัตโนมัติ (ไม่ parallel เพราะกิน memory มากถ้าเปิดหลายวิดีโอพร้อมกัน) แล้วรวมผลลัพธ์ทั้งหมดเป็น ZIP ให้ดาวน์โหลดครั้งเดียว

ติดตั้ง dependency เพิ่ม: jszip (สำหรับรวมไฟล์ผลลัพธ์เป็น .zip ให้ดาวน์โหลดทีเดียว)

ส่วนที่ 1 — src/types/wave.ts เพิ่ม:

interface BatchVideoConfig {
  fileNamePattern: string;      // จับคู่กับชื่อไฟล์ที่เลือก (exact match หรือ regex ก็ได้ ระบุให้ชัดในโค้ดว่าใช้แบบไหน — แนะนำ exact match ก่อนเพื่อความง่าย เพิ่ม regex เป็นตัวเลือกเสริมถ้ามีเวลา)
  label?: string;
  overridePoints?: MeasurementPoint[];   // ถ้าไม่ระบุ ใช้ defaultPoints ของ config หลัก
  overrideCalibration?: CalibrationData; // ถ้าไม่ระบุ ใช้ defaultCalibration ของ config หลัก
}

interface BatchConfig {
  defaultCalibration: CalibrationData;
  defaultPoints: MeasurementPoint[];
  videos: BatchVideoConfig[];
  sampleRateHz: number;
}

interface BatchResult {
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMessage?: string;
  statistics?: Record<string, WaveStatistics>;  // key = pointId
  rawData?: Record<string, WaveDataPoint[]>;
}

ส่วนที่ 2 — src/lib/batchProcessor.ts:

export function validateBatchConfig(config: unknown): BatchConfig
- ตรวจสอบ structure ของ config ที่ parse มาจาก JSON ว่าตรงตาม BatchConfig หรือไม่ (ตรวจ field ที่จำเป็นครบ, type ถูกต้อง)
- throw Error พร้อมข้อความชัดเจนบอกว่า field ไหนขาด/ผิด type ถ้าไม่ผ่าน (สำคัญมากเพราะผู้ใช้จะเขียน JSON เองแล้วอาจพิมพ์ผิด ต้อง error message ช่วยเขาแก้ได้)

export function matchVideoToConfig(
  fileName: string,
  batchConfig: BatchConfig
): BatchVideoConfig | null
- หา BatchVideoConfig ที่ fileNamePattern ตรงกับ fileName (exact match) คืนค่า null ถ้าไม่เจอ (ในกรณีนี้ผู้เรียกควรใช้ default config แทน หรือ skip ไฟล์นั้นแล้วแจ้งเตือน — ให้ตัดสินใจ behavior นี้ชัดเจนและอธิบาย comment เหตุผล)

export async function processBatch(
  files: File[],
  batchConfig: BatchConfig,
  onVideoStart: (fileName: string) => void,
  onVideoComplete: (result: BatchResult) => void,
  onVideoError: (fileName: string, error: Error) => void
): Promise<BatchResult[]>
- loop ทีละไฟล์ (sequential ห้าม parallel):
  - เรียก onVideoStart(file.name)
  - หา config ที่ match ด้วย matchVideoToConfig (ถ้าไม่เจอใช้ defaultPoints/defaultCalibration)
  - สร้าง video element + canvas ชั่วคราว, โหลดไฟล์ด้วย URL.createObjectURL
  - เรียก processVideo (จาก Phase 3/7) ด้วย config ที่ได้
  - เรียก computeWaveStatistics ต่อ pointId
  - ลบ object URL ทันทีหลังใช้ (สำคัญมาก เพราะถ้าไม่ revoke จะกิน memory สะสมเรื่อย ๆ ระหว่าง batch หลายไฟล์ จนเบราว์เซอร์ค้าง/crash ได้ในไฟล์ท้าย ๆ ของ batch ยาว ๆ)
  - ถ้า error ใด ๆ เกิดขึ้นระหว่างไฟล์นั้น (เช่น video decode ไม่ได้) ให้ catch ไว้ เรียก onVideoError แล้ว**ทำงานต่อไฟล์ถัดไป** ไม่ให้ error ไฟล์เดียวทำให้ batch ทั้งหมดหยุด
  - เรียก onVideoComplete(result) เมื่อไฟล์นั้นเสร็จ (สำเร็จหรือ error ก็เรียก แต่ status ต่างกัน)
- คืนค่า array ผลลัพธ์ทั้งหมดเมื่อ loop จบทุกไฟล์

ส่วนที่ 3 — src/lib/batchExport.ts:

export async function exportBatchAsZip(results: BatchResult[]): Promise<Blob>
- ใช้ jszip สร้างไฟล์ zip ที่มี:
  - โฟลเดอร์ย่อยต่อวิดีโอ (ชื่อตาม fileName ที่ตัดนามสกุลออก) ข้างในมี raw_data_{pointLabel}.csv ต่อจุดวัด และ summary_report.txt
  - ไฟล์ comparison_summary.csv ที่ root ของ zip เปรียบเทียบทุกวิดีโอ+ทุกจุดในตารางเดียว (คอลัมน์: fileName, pointLabel, hSignificant, hMax, hMean, periodMeanS) เพื่อดูภาพรวมทั้ง batch ได้เร็ว
- คืนค่า Blob พร้อมให้ downloadCSV-style function (จาก Phase 5) เอาไป trigger download

ส่วนที่ 4 — src/components/BatchPanel.tsx:
- input multiple สำหรับเลือกไฟล์วิดีโอหลายไฟล์
- textarea หรือ file input สำหรับ config JSON (parse ด้วย JSON.parse แล้วส่งเข้า validateBatchConfig, แสดง error message ชัดเจนถ้า parse หรือ validate ไม่ผ่าน ก่อนให้กดเริ่ม batch ได้)
- ปุ่ม "ดาวน์โหลด Config ตัวอย่าง" ที่ generate ไฟล์ JSON ตัวอย่างให้ผู้ใช้ดูโครงสร้างที่ต้องเขียน (ใช้ downloadCSV-style mechanism เดิมแต่เปลี่ยน mime type เป็น application/json)
- ตาราง progress แสดงสถานะแต่ละไฟล์ (fileName, status, ปุ่มดูรายละเอียด error ถ้า error) อัปเดตตาม callback onVideoStart/onVideoComplete/onVideoError
- ปุ่ม "เริ่ม Batch Processing" (disable ระหว่างกำลังรัน กัน user กดซ้ำ) และปุ่ม "ดาวน์โหลดผลลัพธ์ทั้งหมด (.zip)" ที่ enable เมื่อ batch เสร็จหมดแล้วเท่านั้น

เพิ่ม route หรือ tab ใหม่ในแอป (เช่น src/app/batch/page.tsx) แยกจากหน้าประมวลผลไฟล์เดียวเดิม เพื่อไม่ให้ UI ปนกันจนสับสน (โหมดไฟล์เดียวกับโหมด batch เป็นคนละ flow ใช้งานกันคนละสถานการณ์)

เขียนเทส:
- src/lib/batchProcessor.test.ts: test validateBatchConfig กับ config ที่ถูกต้องและผิด (field ขาด, type ผิด) หลายกรณี, test matchVideoToConfig ทั้งกรณี match และไม่ match
- test processBatch ด้วย mock processVideo (ไม่ต้องเทสวิดีโอจริงซ้ำเพราะเทสไปแล้วในเฟสก่อน) ตรวจว่า:
  - ถ้าไฟล์ที่ 2 จาก 3 ไฟล์ throw error ระหว่างประมวลผล ไฟล์ที่ 3 ยังถูกประมวลผลต่อจนจบ (ไม่ใช่ batch หยุดทั้งหมด)
  - callback onVideoStart/onVideoComplete/onVideoError ถูกเรียกด้วยลำดับและ argument ที่ถูกต้องตรงกับสถานการณ์ mock ที่ตั้งไว้
- src/lib/batchExport.test.ts: test exportBatchAsZip ด้วย mock BatchResult[] ตรวจว่า zip ที่ได้มีไฟล์ครบตามโครงสร้างที่ระบุ (ใช้ jszip เปิด zip ที่สร้างมาตรวจสอบรายชื่อไฟล์ข้างในอีกที)

รันเทสด้วย `npm run test` และทดสอบด้วยมือ: generate วิดีโอทดสอบ 3 ไฟล์ (amplitude/period ต่างกัน), เขียน config JSON จริงจับคู่กับชื่อไฟล์เหล่านั้น, รัน batch ผ่าน UI จริง, ตรวจว่า zip ที่ดาวน์โหลดมามีข้อมูลถูกต้องครบทุกไฟล์
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด, ทดสอบด้วยมือรัน batch 3 ไฟล์จริงผ่าน UI ได้ผลลัพธ์ zip ที่ถูกต้องครบถ้วน และไฟล์ที่ error (ลองตั้งใจใส่ไฟล์เสียปนไปด้วย) ไม่ทำให้ batch ทั้งหมดหยุดกลางทาง

---

## Phase 11: แก้ Period Bias — Proper Detrend + FFT-Based Period Validation

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 10 หรือเฟสล่าสุดที่ทำถึง) แก้ไข src/lib/waveStatistics.ts และเพิ่มการตรวจสอบคาบคลื่นด้วยวิธี spectral analysis

บริบท/ปัญหาที่พบจากการใช้งานจริง: เมื่อสัญญาณ elevation มี amplitude เล็ก (sub-cm) และมี noise หรือ slow drift หลงเหลืออยู่บ้าง (แม้เพียงเล็กน้อย) วิธี zero up-crossing ที่ detrend ด้วยการลบ global mean แบบเดิม จะทำให้บางรอบคลื่นจริงไม่ตัดผ่านเส้นศูนย์ ทำให้ 2 รอบคลื่นจริงถูกนับรวมเป็นคลื่น 1 ลูกที่มีคาบยาวผิดปกติ ส่งผลให้คาบเฉลี่ยที่คำนวณได้สูงกว่าคาบจริงของคลื่นอย่างเป็นระบบ (ไม่ใช่ random error)

ส่วนที่ 1 — แก้ src/lib/waveStatistics.ts เพิ่มฟังก์ชัน:

export function movingAverageDetrend(
  elevationCm: number[],
  sampleRateHz: number,
  windowSeconds: number
): number[]
- คำนวณ windowSize = Math.round(windowSeconds * sampleRateHz) ปัดให้เป็นเลขคี่เสมอ (บวก 1 ถ้าเป็นเลขคู่) เพื่อให้ window มี center แท้จริง
- คำนวณ moving average แบบ centered ด้วย prefix sum (คำนวณ cumulative sum ก่อนแล้วลบกัน O(n) ไม่ใช่ loop ซ้อน O(n*windowSize) เพื่อ performance)
- คืนค่า array ผลต่าง (originalValue - localMovingAverage) ที่แต่ละจุด — จัดการขอบสัญญาณ (ต้นและท้าย array ที่ window ไม่ครบ) ด้วยการลด window ให้พอดีกับข้อมูลที่มี ไม่ pad ด้วยศูนย์ (ป้องกัน edge artifact)

แก้ computeWaveStatistics ให้รับ parameter เพิ่ม (มี default value เพื่อไม่ทำลาย backward compatibility กับโค้ดเดิมที่เรียกใช้อยู่):

export function computeWaveStatistics(
  timeS: number[],
  elevationCm: number[],
  options?: {
    sampleRateHz?: number;
    detrendMethod?: 'global-mean' | 'moving-average';  // default 'moving-average' ถ้ามี sampleRateHz ให้, ไม่งั้น fallback 'global-mean'
    detrendWindowSeconds?: number;  // default: ถ้าไม่ระบุ ให้ประมาณจากคาบเฉลี่ยที่หาได้รอบแรกด้วย global-mean แล้วคูณ 3 (bootstrap estimate)
  }
): WaveStatistics
- ถ้า detrendMethod เป็น 'moving-average' และมี sampleRateHz: เรียก movingAverageDetrend แทนการลบ global mean แบบเดิมใน zeroUpCrossingWaves (ต้องแก้ zeroUpCrossingWaves ให้รับสัญญาณที่ detrend มาแล้วจากภายนอกได้ ไม่ detrend ซ้ำเองข้างใน หรือแยกฟังก์ชัน detrend ออกมาเป็นพารามิเตอร์ที่ส่งเข้าไปแทน — เลือกวิธีที่โครงสร้างโค้ด clean กว่าและอธิบายเหตุผลใน comment)

ส่วนที่ 2 — เพิ่ม FFT-based period estimation:

ติดตั้ง dependency: fft.js (lightweight FFT library สำหรับ JS ไม่ต้องเขียน FFT เองซึ่งเสี่ยง bug เยอะ)

export interface SpectralPeriodResult {
  dominantFrequencyHz: number;
  dominantPeriodS: number;
  spectrum: { frequencyHz: number; power: number }[];  // เก็บไว้เผื่อ plot กราฟ spectrum ให้ผู้ใช้ดูด้วยตาใน UI
}

export function estimateDominantPeriod(
  elevationCm: number[],
  sampleRateHz: number,
  detrendWindowSeconds?: number,
  frequencyRangeHz?: [number, number]  // ถ้าผู้ใช้รู้ความถี่คร่าว ๆ ที่คาดไว้ (เช่นจากการตั้งค่า wave flume) ให้จำกัดการค้นหาเฉพาะช่วงนี้ ลด false peak จาก noise/drift ความถี่ต่ำมาก ๆ
): SpectralPeriodResult
- detrend สัญญาณก่อนด้วย movingAverageDetrend (หรือ global mean ถ้าไม่ระบุ window) — สำคัญมาก ถ้าไม่ detrend ก่อน FFT จะมี peak ที่ความถี่ 0 (DC) มหาศาลบดบัง peak คลื่นจริง
- ใช้ Hann window function คูณกับสัญญาณก่อนเข้า FFT (ลด spectral leakage มาตรฐานสำหรับสัญญาณความยาวจำกัด)
- เรียก fft.js คำนวณ FFT, คำนวณ power spectrum (|FFT|^2) ของแต่ละ bin ความถี่
- ถ้ามี frequencyRangeHz ให้จำกัดการหา peak เฉพาะช่วงนั้น ไม่งั้นค้นทั้งหมด (ยกเว้น bin 0 ที่เป็น DC ให้ตัดทิ้งเสมอไม่ว่าจะจำกัดช่วงหรือไม่)
- หา bin ที่มี power สูงสุดในช่วงที่ค้นหา = dominant frequency
- แปลงเป็น period (1/frequency)
- คืนค่า SpectralPeriodResult พร้อม spectrum ทั้งหมดสำหรับ plot

ส่วนที่ 3 — แก้ src/components/ResultsSummary.tsx และ ProcessingPanel:
- เพิ่ม input (optional) "ความถี่คลื่นที่คาดไว้ (Hz)" ในหน้าตั้งค่าก่อนประมวลผล (ผู้ใช้รู้ค่านี้อยู่แล้วจากการตั้งค่า wave flume เช่น 0.4Hz) — ใช้ค่านี้ไปคำนวณ detrendWindowSeconds default (เช่น 3/frequency) และ frequencyRangeHz (เช่น ±50% รอบความถี่ที่คาดไว้) ถ้าผู้ใช้ไม่กรอกก็ยังทำงานได้แบบไม่มี hint (ใช้ bootstrap estimate ตามที่ระบุไว้ในส่วนที่ 1)
- แสดงผลเปรียบเทียบสองค่าคาบในตารางสรุป: "คาบเฉลี่ย (Zero up-crossing)" กับ "คาบเด่น (FFT)" คู่กัน ต่อ 1 จุดวัด
- ถ้าค่าสองวิธีต่างกันเกิน 20% (เทียบเป็น % จากค่าน้อยกว่า) ให้แสดง warning banner เล็ก ๆ สีเหลือง/ส้ม ข้อความประมาณ "ค่าคาบจาก 2 วิธีต่างกันมาก อาจมี noise หรือ drift รบกวนสัญญาณอยู่ แนะนำตรวจสอบตำแหน่งจุดวัดหรือลด noise เพิ่มเติม" (ไม่ต้อง block การแสดงผล แค่เตือน)
- เพิ่มกราฟ spectrum เล็ก ๆ (ใช้ recharts เหมือนกราฟอื่น) แสดง power vs frequency ให้ผู้ใช้เห็นด้วยตาว่า peak เด่นชัดแค่ไหน (peak แหลมชัดเจน = สัญญาณสะอาด, peak กว้าง/หลาย peak ใกล้กัน = สัญญาณยังมี noise เยอะ)

เขียน unit test ในไฟล์ src/lib/waveStatistics.test.ts (แก้เพิ่มจากเดิม):

- test movingAverageDetrend: สร้างสัญญาณ sine wave บริสุทธิ์ + slow linear drift (เช่น drift 0.1cm ต่อวินาที) → test ว่าหลัง movingAverageDetrend (window เหมาะสม) ผลลัพธ์ใกล้เคียง sine wave เดิมที่ไม่มี drift มาก (error เทียบกับ sine wave บริสุทธิ์ไม่เกิน 10%) ในขณะที่ detrend แบบ global-mean แบบเดิมจะยังมี drift หลงเหลือชัดเจน (ทำเทสเปรียบเทียบสองวิธีในเทสเดียวกันให้เห็นความต่าง)

- test estimateDominantPeriod: สร้าง sine wave บริสุทธิ์ period ที่รู้ค่าแน่นอน (เช่น 2.5s ตรงกับ 0.4Hz) sample rate 30Hz duration อย่างน้อย 60 วินาที (ต้องยาวพอให้ FFT resolution ละเอียดพอจะแยกความถี่ใกล้เคียงกันได้) → test ว่า dominantPeriodS ที่ได้ใกล้เคียง 2.5s มาก (error ไม่เกิน 5%)

- **เทสสำคัญที่สุดของเฟสนี้**: สร้างสัญญาณจำลองสถานการณ์จริงที่เจอปัญหา — sine wave amplitude เล็ก (เช่น 0.5cm) + slow drift + random noise เล็กน้อย (จำลอง noise ระดับ sub-pixel จากการตรวจจับจริง) → test ว่า:
  (a) zero up-crossing period แบบเดิม (global-mean detrend) ให้ค่าคาบสูงเกินจริงชัดเจน (เกิน 20% ของคาบจริง) — พิสูจน์ว่าปัญหาที่ผู้ใช้เจอ reproduce ได้ในเทส
  (b) zero up-crossing period ที่ใช้ moving-average detrend ใหม่ ให้ค่าใกล้เคียงคาบจริงมากกว่า (error ไม่เกิน 15%)
  (c) estimateDominantPeriod (FFT) ให้ค่าใกล้เคียงคาบจริงมากที่สุดในสามวิธี (error ไม่เกิน 10%)

- test ว่า frequencyRangeHz จำกัดการค้นหาถูกต้อง (สร้างสัญญาณที่มี 2 ความถี่ปนกัน ความถี่หนึ่งอยู่นอกช่วงที่ระบุ ทดสอบว่า estimateDominantPeriod เจอ peak เฉพาะความถี่ที่อยู่ในช่วงที่กำหนดเท่านั้น ไม่ไปเจอความถี่นอกช่วงที่อาจมี power สูงกว่า)

รันเทสด้วย `npm run test` รายงานผลทุกข้อ โดยเฉพาะเทส (a)(b)(c) ในข้อ "เทสสำคัญที่สุด" ต้องแสดงตัวเลข error ของแต่ละวิธีให้เห็นชัดเจนว่าวิธีใหม่ดีขึ้นจริงเทียบกับวิธีเดิมเท่าไหร่

ทดสอบด้วยมือ (`npm run dev`) กับวิดีโอจริงที่เจอปัญหา (H35cm/0.4Hz wave flume) กรอกความถี่คาดไว้ 0.4Hz ในช่องใหม่ แล้วเทียบค่าคาบทั้งสองวิธีที่แสดงผล ว่าตอนนี้ใกล้เคียง 2.5s ทั้งคู่หรือยัง
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด โดยเฉพาะเทสที่ reproduce ปัญหาเดิมได้และพิสูจน์ว่าวิธีใหม่แก้ได้จริง (ไม่ใช่แค่เทสผ่านเฉย ๆ ต้องเห็นตัวเลขเปรียบเทียบชัดเจนในรายงานผล), ทดสอบด้วยมือกับวิดีโอจริงแล้วค่าคาบทั้งสองวิธีต้องใกล้เคียง 2.5s (ความถี่ 0.4Hz) มากกว่าที่เคยได้ 3.25s+ อย่างชัดเจน

---

## Phase 12 (แก้ด่วน): เลือกเฟรมอ้างอิงสำหรับ Calibration ได้อิสระ + ตัดต้นคลิปที่กล้องยังไม่นิ่ง

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp นี่คือ bug fix เร่งด่วนที่ควรทำก่อนเฟสอื่นที่ยังค้างอยู่ (ทำแทรกได้เลยไม่ว่าตอนนี้ทำถึง Phase ไหน)

ปัญหาที่พบจากการใช้งานจริง: ระบบปัจจุบัน (จาก Phase 1/9) hardcode ใช้ "เฟรมแรกของวิดีโอ" (currentTime = 0) เป็นเฟรมอ้างอิงเสมอสำหรับให้ผู้ใช้คลิก calibrate ไม้บรรทัดและจุดวัด แต่ในทางปฏิบัติ ช่วงต้นคลิปมักเป็นช่วงที่ผู้ถ่ายยังขยับกล้องหามุมอยู่ ยังไม่ใช่มุมกล้องที่ใช้ถ่ายคลื่นจริงตลอดคลิป ทำให้ตำแหน่ง ROI/จุดที่คลิกไว้ไม่ตรงกับตำแหน่งจริงในเฟรมส่วนใหญ่ที่เหลือ ต้องแก้ให้ผู้ใช้เลือกเฟรมอ้างอิงเองได้อิสระ

ส่วนที่ 1 — แก้ src/components/RulerCalibrationPanel.tsx (จาก Phase 9) และ src/components/CalibrationCanvas.tsx (จาก Phase 1) ถ้ายังใช้อยู่:
- เพิ่ม video scrubber (input type="range" min={0} max={video.duration} step ละเอียดพอสมควร เช่น 0.1) ผูกกับ video.currentTime ให้ผู้ใช้เลื่อนดูเฟรมไหนก็ได้ของวิดีโอก่อนเริ่ม calibrate
- เพิ่มปุ่ม play/pause เล็ก ๆ ควบคู่กับ scrubber ให้ผู้ใช้เล่นวิดีโอผ่านคร่าว ๆ หาจังหวะที่กล้องเริ่มนิ่งได้สะดวก (ไม่ต้องซับซ้อน แค่ toggle video.play()/video.pause())
- เมื่อ currentTime เปลี่ยน (ผ่าน 'seeked' event หรือ 'timeupdate' throttled) ให้ redraw เฟรมนั้นลง canvas ที่ใช้คลิก calibrate (แทนที่จะ fix ไว้ที่เฟรมแรกเหมือนเดิม)
- แสดงตัวเลข currentTime ปัจจุบันชัดเจนข้าง scrubber (หน่วยวินาที ทศนิยม 1-2 ตำแหน่ง) เพื่อให้ผู้ใช้จดจำ/อ้างอิงเวลาที่เลือกได้
- เก็บค่า calibrationReferenceTimeS ไว้ใน state (ไม่ต้องใช้ที่ไหนต่อในโค้ดส่วนอื่นโดยตรง แต่มีประโยชน์ถ้าต้องบันทึก/แสดงผลอ้างอิงภายหลัง)

ส่วนที่ 2 — เพิ่มการตั้งค่า "จุดเริ่มต้นวิเคราะห์" แยกจากเฟรม calibration:
- เพิ่ม state/input analysisStartTimeS ในหน้าตั้งค่าก่อนประมวลผล (ProcessingPanel จาก Phase 3) — ค่า default = 0 แต่ผู้ใช้ปรับได้ให้ตรงกับวินาทีที่กล้องเริ่มนิ่งจริง (มักจะเป็นเวลาใกล้เคียงกับ calibrationReferenceTimeS ที่เลือกไว้ตอน calibrate แต่ไม่บังคับต้องเท่ากันเป๊ะ ให้ผู้ใช้ปรับอิสระ เพราะบางทีกล้องนิ่งเร็วกว่าตอนที่ผู้ใช้คลิก calibrate เผื่อไว้)
- ใส่ helper text ใต้ input อธิบายว่า "ระบุวินาทีที่กล้องเริ่มนิ่ง/เข้าตำแหน่งถ่ายจริง ข้อมูลก่อนหน้านี้จะไม่ถูกใช้วิเคราะห์"

ส่วนที่ 3 — แก้ src/lib/videoProcessor.ts:
- แก้ processVideo (และ RulerCalibrationTracker ถ้าเกี่ยวข้อง) ให้เริ่ม loop จาก t = analysisStartTimeS แทนที่จะเริ่มจาก 0 เสมอ
- แก้ auto-baseline detection (จาก Phase 3: อ่าน 30 เฟรมแรกหา median) ให้อ่านจาก analysisStartTimeS ถึง analysisStartTimeS + (30/sampleRateHz) แทนที่จะอ่านจาก t=0 เสมอ — สำคัญมาก เพราะนี่คือจุดที่ทำให้ baseline เพี้ยนถ้ายังใช้ช่วงกล้องไม่นิ่ง
- output WaveTimeSeries.timeS ที่ได้ ควรเริ่มนับจาก 0 ใหม่ (คือ timeS[0] = 0 หมายถึง analysisStartTimeS จริงในวิดีโอ ไม่ใช่ absolute time ของไฟล์) เพื่อให้กราฟ/สถิติอ่านง่าย ไม่ต้องมาลบเวลาเริ่มต้นทีหลังทุกที่ที่ใช้ค่านี้ — comment อธิบายจุดนี้ให้ชัดในโค้ดกัน confusion

ส่วนที่ 4 — validation กันผู้ใช้ตั้งค่าผิดพลาด:
- ถ้า analysisStartTimeS มากกว่าหรือใกล้เคียง video.duration มากเกินไป (เหลือเวลาน้อยกว่า เช่น 5 วินาที) ให้แจ้งเตือนก่อนเริ่มประมวลผล ("ช่วงเวลาที่เหลือสำหรับวิเคราะห์สั้นเกินไป อาจไม่พอสำหรับคำนวณสถิติคลื่นที่น่าเชื่อถือ") ไม่ต้อง block การทำงาน แค่เตือน
- ถ้า calibrationReferenceTimeS ที่เลือกไว้ห่างจาก analysisStartTimeS มาก (เช่นเกิน 10 วินาที) ให้แสดงคำเตือนแนะนำเบา ๆ ว่า "แนะนำเลือกเฟรม calibrate ให้ใกล้เคียงกับช่วงเวลาที่จะวิเคราะห์จริง เพื่อความแม่นยำของ ROI ไม้บรรทัด" (ไม่ block เช่นกัน เป็นแค่คำแนะนำ เพราะ Phase 9 ruler tracking ควรตามการเปลี่ยนแปลงได้อยู่แล้วถ้าไม่ห่างเกินไป)

เขียน/แก้ unit test:
- src/lib/videoProcessor.test.ts (แก้เพิ่ม): test ว่า processVideo ที่ตั้ง analysisStartTimeS > 0 ให้ output WaveTimeSeries ที่ timeS เริ่มจาก 0 จริง (ไม่ใช่เริ่มจาก analysisStartTimeS) และจำนวนจุดข้อมูลตรงกับ (duration - analysisStartTimeS) * sampleRateHz ไม่ใช่ duration เต็มคูณ sampleRateHz
- test ว่า auto-baseline detection ใช้ช่วงเวลาที่ถูกต้อง (mock video ที่มีค่าต่างกันชัดเจนระหว่างช่วงก่อน/หลัง analysisStartTimeS แล้วตรวจว่า baseline ที่คำนวณได้ตรงกับช่วงหลังเท่านั้น)
- component test สำหรับ scrubber: mock video element, จำลองการลาก scrubber แล้วตรวจว่า currentTime ของ video ถูกอัปเดตตรงตามค่าที่ลาก และ canvas ถูก redraw (เรียก drawImage) ตามเฟรมใหม่

รันเทสด้วย `npm run test` และทดสอบด้วยมือ (`npm run dev`): เปิดวิดีโอที่มีปัญหาเดิม (กล้องขยับหามุมช่วงแรก) ลอง scrub ไปเลือกเฟรมตอนกล้องนิ่งแล้วมา calibrate ตรงนั้น ตั้ง analysisStartTimeS ให้ตรงกับช่วงที่กล้องนิ่ง แล้วรันประมวลผลใหม่ เทียบผลลัพธ์กับก่อนแก้ว่าค่าที่วัดได้สมเหตุสมผลขึ้นชัดเจนมั้ย (ไม่ควรเห็น "ขั้นบันได" ผิดปกติแบบเดิมในช่วงต้นกราฟอีก)
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด, ทดสอบด้วยมือแล้วเลือกเฟรม/ช่วงเวลาที่กล้องนิ่งได้จริง ผลลัพธ์กราฟ elevation ไม่มีความผิดปกติจากช่วงกล้องขยับหลงเหลืออยู่ตอนต้นอีกต่อไป

---

## Phase 13 (แก้ด่วน): บั๊กต้องกดรีเซ็ตก่อนภาพขึ้น หลังอัปโหลดคลิปใหม่ทุกครั้ง

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ตอนนี้ทำถึง Phase 12 แล้ว) แก้บั๊กเร่งด่วน: หลังอัปโหลดวิดีโอใหม่ ต้องกดปุ่ม "รีเซ็ต" ก่อนภาพ/เฟรมถึงจะแสดงผล เกิดขึ้นซ้ำทุกขั้นตอนที่มีการแสดงเฟรมวิดีโอ (calibration canvas, ruler panel, live viewer)

วินิจฉัยสาเหตุที่เป็นไปได้ (ให้ตรวจสอบและแก้ทั้งสองจุด เพราะมักเกิดร่วมกัน):

สาเหตุที่ 1 — stale event listener / component ไม่ remount เมื่อเปลี่ยนวิดีโอ:
ตรวจสอบทุก component ที่แสดงเฟรมวิดีโอบน canvas (VideoUploader, RulerCalibrationPanel/CalibrationCanvas จาก Phase 1/9/12, LiveViewerCanvas จาก Phase 8) ว่า:
- เมื่อ prop videoUrl เปลี่ยน (อัปโหลดไฟล์ใหม่) useEffect ที่ผูก event listener ('seeked', 'loadeddata', 'timeupdate') มี cleanup function (return () => video.removeEventListener(...)) ครบทุกตัวที่ addEventListener ไว้หรือไม่ ถ้าขาด cleanup จะเกิด listener ซ้อนทับหลายชุดจากวิดีโอเก่า/ใหม่ปนกัน ทำให้ state สับสน
- เพิ่ม `key={videoUrl}` ให้กับ component หลักที่ครอบ video+canvas (หรือกับ <video> element เอง) เพื่อบังคับให้ React unmount/remount component ใหม่ทั้งชุดทุกครั้งที่ videoUrl เปลี่ยน วิธีนี้รับประกันว่าไม่มี state/listener เก่าหลงเหลือข้ามไฟล์แน่นอน (เป็นวิธีที่ปลอดภัยที่สุดสำหรับปัญหานี้ ให้ใช้เป็นทางแก้หลัก)

สาเหตุที่ 2 — video.currentTime ไม่เปลี่ยนค่าจริง ทำให้ 'seeked' ไม่ยิง:
แก้ src/lib/videoProcessor.ts ฟังก์ชัน captureFrameAtTime (จาก Phase 3):
- ก่อน set video.currentTime = timeS ให้เช็คก่อนว่า Math.abs(video.currentTime - timeS) < 0.01 (เกือบเท่าเดิมอยู่แล้ว) และ video.readyState >= 2 (HAVE_CURRENT_DATA ขึ้นไป แปลว่ามีเฟรมพร้อมแสดงจริง ไม่ใช่แค่ metadata) — ถ้าเข้าเงื่อนไขนี้ ให้ drawImage ทันทีโดยไม่ต้อง set currentTime หรือรอ event 'seeked' เลย (เพราะรู้อยู่แล้วว่าไม่มี event ยิงแน่นอนในเคสนี้)
- ถ้าไม่เข้าเงื่อนไขข้างต้น ค่อย set currentTime แล้วรอ 'seeked' ตามเดิม
- เพิ่ม fallback: ถ้ารอ 'seeked' เกิน timeout (ตามที่มีอยู่แล้วจาก Phase 3) ให้ลอง drawImage จากสถานะปัจจุบันของ video ไปเลยก่อน reject (เผื่อ event ไม่ยิงด้วยเหตุผลอื่นที่ไม่ได้คาดไว้ ยังได้ภาพประมาณดีกว่าค้างไปเลย) — log คำเตือนไว้ด้วยว่าใช้ fallback path

สาเหตุที่ 3 (ตรวจสอบเพิ่มเติม) — การโหลดวิดีโอใหม่ไม่รอให้พร้อมก่อนพยายามวาดเฟรมแรก:
- ตรวจสอบว่าตอนอัปโหลดไฟล์ใหม่ (VideoUploader component) การพยายามวาดเฟรมแรกลง canvas (เช่นใน RulerCalibrationPanel) เกิดขึ้น**หลังจาก** video element ยิง 'loadeddata' แล้วเท่านั้น ไม่ใช่พยายามวาดทันทีที่ videoUrl prop เปลี่ยน (ตอนนั้น video อาจยังโหลดไม่เสร็จ readyState ยังไม่ถึง HAVE_CURRENT_DATA) — ถ้าโค้ดปัจจุบันไม่ได้รอ 'loadeddata' ก่อน ให้แก้ไขเพิ่ม

หลังแก้ทั้งสามจุด ให้ทดสอบ manual flow ที่เคยมีปัญหาโดยเฉพาะ (ไม่ต้องพึ่ง unit test อัตโนมัติเพราะเป็นบั๊กเกี่ยวกับ browser event timing ที่เทสอัตโนมัติ mock ยาก):
- อัปโหลดวิดีโอไฟล์ A → เห็นเฟรมแรกขึ้นทันทีโดยไม่ต้องกดอะไรเพิ่ม
- ลบ/reset แล้วอัปโหลดวิดีโอไฟล์ B (คนละไฟล์) ทันที → เห็นเฟรมแรกของไฟล์ B ขึ้นทันที ไม่ใช่ค้างเป็นเฟรมของไฟล์ A หรือจอว่าง
- ทำซ้ำ 3-4 รอบสลับไฟล์ A/B/C เพื่อมั่นใจว่าไม่มี state หลงเหลือข้ามไฟล์เลยสักครั้ง
- ทดสอบเหมือนกันในทุกหน้าที่มีการแสดงเฟรมวิดีโอ (calibration, ruler panel, live viewer ตอนเริ่มประมวลผล)

เขียน unit test เท่าที่ทำได้ในไฟล์ src/lib/videoProcessor.test.ts (แก้เพิ่ม):
- test captureFrameAtTime ด้วย mock video element ที่ currentTime เท่ากับ timeS ที่ขอตั้งแต่แรก (mock readyState = 2) → ต้อง resolve ทันทีโดยไม่มีการเรียก addEventListener('seeked', ...) เลย (ตรวจสอบด้วย mock/spy ว่าไม่ถูกเรียก)
- test captureFrameAtTime กรณีปกติที่ currentTime ต่างจาก timeS → ยังคง set currentTime แล้วรอ 'seeked' ตามเดิม (ไม่ regression พฤติกรรมเดิม)

รันเทสด้วย `npm run test` รายงานผล และเน้นทดสอบ manual flow ข้างบนด้วยมือให้ครบทุกหน้า เพราะเป็นจุดที่ automated test คุมได้ไม่หมด
```

**เกณฑ์ผ่านเฟส:** unit test ที่เทสได้ผ่านหมด, **สำคัญที่สุดคือทดสอบด้วยมือ**อัปโหลด-สลับไฟล์วิดีโอหลายรอบในทุกหน้าที่มี canvas แสดงเฟรม แล้วภาพต้องขึ้นเองทันทีทุกครั้งโดยไม่ต้องกดรีเซ็ตอีกต่อไป

---

## Phase 14 (เสริม): เร่งความเร็วด้วย requestVideoFrameCallback

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 13 หรือเฟสล่าสุดที่ทำถึง) เพิ่มโหมดประมวลผลแบบเร็วโดยใช้ Video.requestVideoFrameCallback (rVFC) แทนการ seek ทีละเฟรมแบบเดิม (captureFrameAtTime จาก Phase 3) เป็นทางเลือกเสริม ไม่ใช่แทนที่ของเดิมทั้งหมด — ต้อง fallback ไปโหมดเดิมอัตโนมัติถ้าเบราว์เซอร์ไม่รองรับ

บริบทสำคัญ: rVFC ทำงานได้เฉพาะระหว่าง**เล่นวิดีโอจริง** (ไม่ใช่ seek ไปเวลาที่ต้องการแบบสุ่มได้เหมือนเดิม) callback จะถูกเรียกครั้งละ 1 เฟรมที่ถูก decode และเตรียมแสดงผลจริง พร้อม metadata.mediaTime ที่บอกตำแหน่งเวลาที่แม่นยำของเฟรมนั้น ข้อดีคือได้ timestamp จริงแม่นยำกว่าการ seek+รอ 'seeked' event ที่มี overhead สูง (โดยเฉพาะการ seek ไป keyframe ที่ห่างกันเยอะ) ข้อเสียคือ: ผลลัพธ์ที่ได้มี timestamp ไม่สม่ำเสมอ (ไม่ตรง grid ของ sampleRateHz แบบเดิม) ต้อง resample ก่อนส่งเข้าโค้ดสถิติ (Phase 4/11) ที่มีอยู่

ส่วนที่ 1 — src/lib/frameCallbackProcessor.ts (ไฟล์ใหม่):

export function supportsVideoFrameCallback(): boolean
- ตรวจสอบ typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype
- ใช้ feature detection เท่านั้น ไม่ต้อง hardcode รายชื่อเบราว์เซอร์ (กัน false negative/positive เมื่อเบราว์เซอร์อื่นเพิ่ม support ในอนาคต)

export interface FrameCallbackOptions extends ProcessingOptions {
  playbackRate?: number;  // default 4 — เล่นเร็วกว่าปกติเพื่อประมวลผลไวขึ้น แต่สูงไปจะทำให้ browser drop เฟรมเยอะจนข้อมูลห่างเกินไป
  maxQueueSize?: number;  // default 50 — จำกัดจำนวนเฟรมที่รอคิวส่งเข้า worker กัน memory บวมถ้า worker ตามไม่ทัน
}

export async function processVideoWithFrameCallback(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  calibration: RulerCalibration,   // จาก Phase 9
  points: MeasurementPoint[],       // จาก Phase 7
  options: FrameCallbackOptions
): Promise<Record<string, WaveDataPoint[]>>

การทำงาน:
1. seek ไป options.analysisStartTimeS ก่อน (จาก Phase 12) ด้วยกลไก captureFrameAtTime เดิม (ครั้งเดียวตอนเริ่ม ไม่บ่อย ไม่มีปัญหา overhead)
2. ตั้ง video.playbackRate = options.playbackRate
3. สร้าง queue (array) เก็บ { imageData, mediaTime } รอประมวลผล และตัวแปรนับผลลัพธ์ที่ได้แล้ว
4. เริ่ม rVFC loop:
   function onFrame(now, metadata) {
     - ถ้า video.currentTime เกิน end time ที่ต้องการ (duration เต็ม หรือ analysisEndTimeS ถ้ามี) ให้หยุดไม่ schedule ต่อ, สั่ง video.pause(), แล้วไป cleanup/resolve
     - crop เฉพาะบริเวณที่ต้องใช้ (ทุก measurement points + ruler ROI ถ้าถึงรอบ check) แล้ว push เข้า queue พร้อม metadata.mediaTime (ปรับให้ relative กับ analysisStartTimeS)
     - ถ้า queue.length เกิน maxQueueSize ให้ log คำเตือนและพิจารณาลด video.playbackRate ลงอัตโนมัติ (เช่นลดลงครึ่งหนึ่ง) เพื่อให้ worker ตามทัน — อธิบาย trade-off นี้ใน comment ชัดเจน
     - เรียก video.requestVideoFrameCallback(onFrame) ต่อเนื่องเป็นลูป (ไม่ใช่ setInterval)
   }
   video.requestVideoFrameCallback(onFrame) เริ่มครั้งแรก แล้ว video.play()
5. คู่ขนานกับ loop ข้างบน รัน async worker-consumer loop แยกต่างหาก: ดึงจาก queue ทีละรายการ (หรือ batch เล็ก ๆ) ส่งเข้า worker (reuse worker เดิมจาก Phase 3/7/9) ไม่ block loop การจับเฟรม
6. เมื่อ capture loop จบ (ข้อ 4) ให้รอ queue ว่างสนิท (drain) ก่อน resolve
7. เรียก options.onProgress ตามสัดส่วน video.currentTime / (endTime - startTime) เหมือนโหมดเดิม
8. เรียก options.onFrameProcessed ต่อเฟรมเหมือนเดิมสำหรับ LiveViewerCanvas (Phase 8)
9. รองรับ pause/resume (Phase 8): pause คือเรียก video.pause() ตรง ๆ (rVFC จะไม่ยิงต่อเองระหว่าง pause โดยธรรมชาติอยู่แล้ว ไม่ต้องทำอะไรเพิ่ม), resume คือ video.play() ต่อ
10. คืนค่าเป็น Record<pointId, WaveDataPoint[]> ที่ timestamp ยังไม่สม่ำเสมอ (ยังไม่ resample ในฟังก์ชันนี้ แยกความรับผิดชอบชัดเจน)

ส่วนที่ 2 — src/lib/resample.ts (ไฟล์ใหม่):

export function resampleToUniformGrid(
  data: WaveDataPoint[],
  targetSampleRateHz: number,
  durationS: number
): WaveDataPoint[]
- สร้าง grid เวลาสม่ำเสมอตั้งแต่ 0 ถึง durationS ตาม targetSampleRateHz
- ใช้ linear interpolation ระหว่างจุดข้อมูลจริงที่ใกล้ที่สุดสองจุด (ก่อน-หลัง) ของแต่ละตำแหน่งบน grid เพื่อประมาณค่า elevationCm (และ confidence ใช้ค่าเฉลี่ยถ่วงน้ำหนักตามระยะใกล้-ไกล หรือค่าที่ใกล้ที่สุดก็พอ ระบุให้ชัดว่าเลือกวิธีไหนและทำไม)
- จัดการขอบเขต (grid point ก่อนจุดข้อมูลแรกสุดหรือหลังจุดสุดท้าย) ด้วยการ clamp ไปใช้ค่าขอบใกล้สุดแทนการ extrapolate (กัน error สะสมนอกช่วงข้อมูลจริง)

ส่วนที่ 3 — แก้ src/lib/videoProcessor.ts เพิ่ม unified entry point:

export type ProcessingMode = 'auto' | 'seek-based' | 'frame-callback'

export async function processVideoAuto(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  calibration: RulerCalibration,
  points: MeasurementPoint[],
  options: ProcessingOptions & { mode?: ProcessingMode; playbackRate?: number }
): Promise<Record<string, WaveDataPoint[]>>
- ถ้า mode === 'seek-based': เรียก processVideo เดิม (Phase 3/7/9/12) ตรง ๆ
- ถ้า mode === 'frame-callback': เรียก processVideoWithFrameCallback แล้ว resampleToUniformGrid ผลลัพธ์แต่ละ point ก่อนคืนค่า (ให้ downstream Phase 4/11 ใช้ต่อได้แบบไม่ต้องแก้อะไรเพิ่ม)
- ถ้า mode === 'auto' (default): เรียก supportsVideoFrameCallback() ถ้า true ใช้ frame-callback (พร้อม resample) ถ้า false fallback ไป seek-based พร้อม log แจ้งเหตุผลให้เห็นใน console (ไม่ต้อง alert ผู้ใช้แบบรบกวน UI)

ส่วนที่ 4 — แก้ src/components/ProcessingPanel.tsx:
- เพิ่ม select "โหมดประมวลผล" ตัวเลือก: Auto (แนะนำ) / Seek-based (เข้ากันได้ทุกเบราว์เซอร์) / Frame-callback (เร็ว, รองรับเฉพาะ Chromium)
- ถ้าเลือก Frame-callback หรือ Auto ที่ตรวจพบว่ารองรับ: แสดง input playbackRate (default 4, ช่วง 1-16) พร้อม helper text เตือนว่า "ค่าสูงเกินไปอาจทำให้ browser ข้ามเฟรม ได้ข้อมูลเบาบางเกินไปสำหรับคลื่นความถี่สูง แนะนำเช็คความหนาแน่นข้อมูลที่ได้จริงหลังประมวลผล (ดูจาก confidence/จำนวนจุดข้อมูลต่อวินาที) ถ้าเบาบางเกินไปให้ลด playbackRate ลง"
- ถ้าเบราว์เซอร์ไม่รองรับและผู้ใช้เลือก Frame-callback ตรง ๆ (ไม่ใช่ Auto) ให้แสดงข้อความแจ้งเตือนชัดเจนพร้อมปุ่มสลับไป Seek-based ให้ทันที

เขียน unit test:
- src/lib/frameCallbackProcessor.test.ts: test supportsVideoFrameCallback() ทั้งกรณี mock ว่ามี/ไม่มี method นี้ใน prototype
- src/lib/resample.test.ts: test resampleToUniformGrid ด้วยข้อมูล irregular ที่รู้ค่าแน่นอน (เช่น 3 จุดข้อมูลที่ timestamp ไม่เท่ากัน) → ตรวจว่าค่าที่ interpolate มาตรงกับที่คำนวณมือได้ที่ grid point ต่าง ๆ, test edge case ที่ grid point อยู่นอกช่วงข้อมูลจริง (ต้อง clamp ไม่ extrapolate)
- integration test (ถ้าเป็นไปได้ในสภาพแวดล้อม test ที่มี jsdom/browser mock รองรับ rVFC — ถ้า mock ยากเกินไปให้ข้ามและระบุเหตุผลชัดเจนในโค้ด comment แทนที่จะฝืนเขียนเทสที่ไม่น่าเชื่อถือ): test ว่า processVideoAuto เลือก path ถูกต้องตาม supportsVideoFrameCallback() ที่ mock ไว้

รันเทสด้วย `npm run test` รายงานผล

ทดสอบด้วยมือ (สำคัญมากเพราะเทสอัตโนมัติคุม rVFC จริงไม่ได้): ใช้วิดีโอทดสอบเดียวกัน (จาก Phase 6 synthetic test video) รันทั้งสองโหมด (seek-based กับ frame-callback) เทียบกัน:
- วัดเวลาที่ใช้จริง (wall-clock) ของแต่ละโหมด รายงาน speedup ratio
- เทียบค่า hSignificant/periodMeanS ที่ได้จากสองโหมด ต้องใกล้เคียงกัน (error ไม่เกิน 10%) ยืนยันว่า resample ไม่ทำให้ผลเพี้ยน
- ลองตั้ง playbackRate สูง ๆ (เช่น 16) แล้วสังเกตว่าความหนาแน่นข้อมูลลดลงจริงและผลเริ่มคลาดเคลื่อนมากขึ้นเมื่อไหร่ เพื่อหาค่า playbackRate ที่เหมาะสมกับวิดีโอจริงของคุณ (ความถี่คลื่น 0.4Hz ต้องการ sample rate อย่างน้อย ~10x ของความถี่ คือ 4Hz ขึ้นไปเป็นอย่างต่ำ ควรตั้งเผื่อสูงกว่านั้นมากเพื่อความแม่นยำของ zero up-crossing)
```

**เกณฑ์ผ่านเฟส:** unit test ที่เทสได้ผ่านหมด, ทดสอบด้วยมือเทียบสองโหมดแล้วผลลัพธ์ใกล้เคียงกัน (พิสูจน์ว่า resample ไม่ทำให้ข้อมูลเพี้ยน) และเห็น speedup จริงจากโหมด frame-callback เมื่อรันบน Chromium — ถ้าไม่รองรับเบราว์เซอร์ที่ทดสอบอยู่ ให้ยืนยันว่า fallback ไป seek-based ทำงานถูกต้องแทน (ฟีเจอร์นี้เป็นส่วนเสริม ไม่บังคับต้องมี ถ้า auto-fallback ทำงานถูกต้องก็ถือว่าผ่านเกณฑ์แล้ว)

---

## Phase 15 (แก้ด่วน): รวมเฟรมอ้างอิงของ Ruler Calibration กับ Point Configuration ให้เป็นเฟรมเดียวกัน

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ตอนนี้ทำถึง Phase 14 แล้ว) แก้บั๊กเร่งด่วน: ขั้นตอน calibrate ไม้บรรทัด/ขีด (RulerCalibrationPanel จาก Phase 9/12) กับขั้นตอนตั้งค่าและเลือกจุดวัดคลื่น (ProcessingPanel/PointSelector จาก Phase 3/7) ใช้เฟรมวิดีโอคนละเฟรมกันในการแสดงผล/คลิกมาร์กตำแหน่ง ทำให้ตำแหน่งที่มาร์กไว้ไม่สอดคล้องกันถ้ากล้องขยับระหว่างสองช่วงเวลานั้น

ก่อนแก้ ให้สำรวจโค้ดปัจจุบันก่อนว่า RulerCalibrationPanel และ PointSelector/ProcessingPanel เป็น component แยกกันจริงที่มี canvas preview เป็นของตัวเองคนละตัว หรือมีการใช้ canvas ร่วมกันอยู่แล้วบางส่วน (โครงสร้างจริงอาจต่างจากที่ระบุไว้ในเฟสก่อน ๆ เพราะผ่านการแก้หลายรอบมาแล้ว) แล้วเลือกแนวทางแก้ที่เหมาะกับโค้ดจริงที่มีอยู่ระหว่างสองแบบนี้:

แนวทางที่แนะนำ (Option A) — รวมเป็นขั้นตอนเดียว canvas เดียว:
- รวม RulerCalibrationPanel และส่วนเลือกจุดวัดคลื่น (MeasurementPoint selector จาก Phase 7) เข้าเป็น component เดียวกัน ใช้ video scrubber ตัวเดียว (จาก Phase 12) ควบคุมเฟรมที่แสดงร่วมกันทั้งหมด
- ลำดับการทำงานในหน้าเดียวนี้: (1) scrub หาเฟรมที่กล้องนิ่ง (2) วาดกรอบ ROI ไม้บรรทัด + คลิก 2 ขีดพร้อมค่าจริง (3) คลิกเพิ่มจุดวัดคลื่นหลายจุด (ยังอยู่บนเฟรมเดียวกันนี้ ไม่เปลี่ยนเฟรมระหว่างขั้นตอนย่อยเหล่านี้เด็ดขาด)
- ย้าย input ที่เกี่ยวกับการตั้งค่าจุดวัด (label, สี, xOffsetCm ที่คำนวณจากตำแหน่งคลิกบวกกับ calibration) มารวมอยู่ใน component เดียวกันนี้
- ส่วนที่ไม่เกี่ยวกับตำแหน่ง/เฟรม (เช่น sampleRateHz, analysisStartTimeS, ความถี่คลื่นที่คาดไว้จาก Phase 11, playbackRate จาก Phase 14) ยังแยกเป็นหน้า/ส่วนถัดไปได้ตามเดิม เพราะไม่ต้องพึ่งภาพเฟรมแล้ว

ถ้ารวมเป็น component เดียวไม่สะดวกกับโครงสร้างโค้ดปัจจุบัน (เช่น UX ตั้งใจแยกหน้าชัดเจนด้วยเหตุผลอื่น) ให้ใช้แนวทางสำรอง (Option B) แทน:

แนวทางสำรอง (Option B) — ยก state เฟรมอ้างอิงขึ้นที่เดียว บังคับทุก canvas sync กัน:
- ยก state calibrationReferenceTimeS ขึ้นไปอยู่ที่ src/app/page.tsx (หรือ context/store กลางถ้าโปรเจกต์มีอยู่แล้ว) ไม่ให้เป็น local state ของ component ใดคนหนึ่งอีกต่อไป
- ส่ง calibrationReferenceTimeS และ setter ลงไปเป็น prop ให้ทุก component ที่มี canvas แสดงเฟรมวิดีโอสำหรับ mark ตำแหน่ง (RulerCalibrationPanel, PointSelector/ProcessingPanel, และอื่น ๆ ถ้ามี)
- ทุก component เหล่านี้ต้อง draw เฟรมด้วย captureFrameAtTime(video, canvas, calibrationReferenceTimeS) เวลาเดียวกันเสมอ ไม่มี component ไหนมี default เป็นของตัวเอง (เช่นห้าม default กลับไป 0 เอง)
- scrubber ที่ใช้เปลี่ยน calibrationReferenceTimeS ให้มีแค่จุดเดียวในทั้งแอป (อยู่ที่ component แรกสุดของ flow calibrate) ส่วน component ถัดไปที่ใช้เฟรมเดียวกันแสดงเฟรมนั้นแบบ read-only (ไม่มี scrubber ซ้ำ) พร้อมข้อความกำกับชัดเจน เช่น "แสดงเฟรมที่ 12.4s (เฟรมอ้างอิงเดียวกับตอน calibrate ไม้บรรทัด)" เพื่อให้ผู้ใช้มั่นใจได้ด้วยตาว่าเฟรมตรงกันจริง ไม่ต้องเดา
- ถ้าจำเป็นต้องให้ผู้ใช้เปลี่ยนเฟรมอ้างอิงใหม่หลังจากเข้าสู่ขั้นตอนถัดไปแล้ว (เช่นกดย้อนกลับไปแก้) ให้มี mechanism แจ้งเตือนว่าจุดที่เคยมาร์กไว้ในขั้นตอนถัดไป (measurement points) อาจไม่ตรงกับเฟรมใหม่อีกต่อไป ต้องมาคลิกใหม่ (ไม่ auto-carry ตำแหน่งเดิมข้ามเฟรมที่ต่างกัน เพราะพิกเซลตำแหน่งเดิมอาจไม่ตรงกับ scene เดิมแล้ว)

ไม่ว่าจะเลือก Option A หรือ B ให้ตรวจสอบเพิ่มเติมว่า:
- LiveViewerCanvas (Phase 8) ที่แสดง overlay ระหว่างประมวลผลจริง ใช้เฟรมจากวิดีโอ ณ เวลาที่กำลังประมวลผลอยู่ (ไม่เกี่ยวกับ calibrationReferenceTimeS โดยตรง อันนี้ถูกต้องอยู่แล้วไม่ต้องแก้) — แต่ตำแหน่ง overlay marker (xColumn, baselineY ที่คำนวณจาก xOffsetCm/baselineValueCm ผ่าน ruler tracker) ต้องยังคงอ้างอิงจาก calibration ที่ตั้งไว้บนเฟรมอ้างอิงเดียวกันข้างต้นอยู่เสมอ ห่วงโซ่การอ้างอิงต้องสอดคล้องกันตลอดทั้งระบบ

เขียน/แก้ unit test:
- component test (ถ้าเลือก Option A): render component รวมแล้วตรวจว่า canvas เดียวถูกใช้ตลอด flow (mock drawImage เรียกด้วย video element/currentTime เดียวกันทุกครั้งตลอดการคลิก ROI/ขีด/จุดวัด)
- component test (ถ้าเลือก Option B): mock calibrationReferenceTimeS ที่ page.tsx ระดับบนสุด ตรวจว่า RulerCalibrationPanel และ PointSelector/ProcessingPanel ทั้งคู่ได้รับค่าเดียวกันและเรียก captureFrameAtTime ด้วย timeS เดียวกัน (ใช้ spy/mock ตรวจ argument ที่ถูกเรียก)
- test regression: ตรวจว่าถ้าผู้ใช้เปลี่ยน calibrationReferenceTimeS หลังจากมี measurement points อยู่แล้ว ระบบแจ้งเตือน/เคลียร์ตำแหน่งเดิมตามที่ออกแบบไว้ ไม่ปล่อยให้ตำแหน่งเดิมค้างแบบเงียบ ๆ โดยไม่มีการแจ้งอะไรเลย (เพราะจะกลับไปเป็นบั๊กเดิมอีก)

รันเทสด้วย `npm run test` และทดสอบด้วยมือ (`npm run dev`) ด้วยวิดีโอที่กล้องขยับมากในตอนต้น: scrub หาเฟรมที่กล้องนิ่ง calibrate ไม้บรรทัด+ขีด แล้วไปหน้าจอ/ขั้นตอนเลือกจุดวัดคลื่น ตรวจด้วยตาว่าเฟรมที่เห็นในทั้งสองที่ (หรือทั้งหมดถ้ารวมเป็นหน้าเดียว) เป็นภาพเดียวกันเป๊ะ ไม่ใช่คนละมุมกล้องอีกต่อไป
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด, ทดสอบด้วยมือแล้วยืนยันด้วยตาว่าทุกขั้นตอนของการ mark ตำแหน่ง (ไม้บรรทัด, ขีด, จุดวัดคลื่นทุกจุด) ใช้ภาพเฟรมเดียวกันเป๊ะตลอดทั้ง flow ไม่มีจุดไหนสลับไปแสดงเฟรมอื่นโดยไม่ตั้งใจอีก

---

## Phase 16 (แก้ด่วน): จุดตรวจจับกระโดดไปติด Edge ผิดในเฟรมแรก (ไม่ใช่ผิวน้ำ)

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ตอนนี้ทำถึง Phase 15 แล้ว) แก้บั๊กเร่งด่วน: จุดตรวจจับผิวน้ำ (MeasurementPoint) ไปล็อกติดตำแหน่งผิดในเฟรมแรก (เช่น ขีดไม้บรรทัด, ขอบจอมือถือ, กรอบหน้าต่าง) แทนที่จะเป็นผิวน้ำจริง แล้วค้างอยู่ตำแหน่งผิดนั้นตลอดทั้งคลิปเพราะเฟรมถัดไปค้นหาแค่บริเวณใกล้เคียงตำแหน่งที่ล็อกผิดไว้แล้ว

สาเหตุ (ยืนยันจากพฤติกรรมเดิมของ SurfaceTracker.detect ตั้งแต่ Phase 2): เมื่อยังไม่มีตำแหน่งก่อนหน้า (เฟรมแรกของแต่ละจุดวัด) โค้ดปัจจุบันค้นหา strongest gradient แบบไม่จำกัดขอบเขต (search ทั่วทั้งภาพ/ทั่วทั้งคอลัมน์) ซึ่งใช้ได้ในสถานการณ์ทดสอบง่าย ๆ ตอนต้น แต่ในเฟรมจริงที่มีวัตถุ contrast สูงหลายอย่างในเฟรม (ไม้บรรทัด, มือถือ, กรอบหน้าต่าง) ทำให้ไปล็อกผิดวัตถุตั้งแต่เฟรมแรก

ทางแก้: ใช้ตำแหน่งพิกเซลที่ผู้ใช้คลิกตอนเพิ่ม MeasurementPoint (จาก Phase 7/15 UI) เป็นจุดศูนย์กลางการค้นหาของเฟรมแรกเสมอ (มี margin รอบ ๆ พอสมควร ไม่ใช่ทั่วภาพ) แทนการค้นหาแบบไม่มีขอบเขต

ส่วนที่ 1 — แก้ src/types/wave.ts:
เพิ่ม field ใน MeasurementPoint:
  initialGuessPixelY: number;   // ตำแหน่ง y พิกเซลที่ผู้ใช้คลิกตอนเพิ่มจุดนี้ บนเฟรมอ้างอิงที่ใช้ calibrate (จาก Phase 15) — ใช้เป็น seed การค้นหาเฟรมแรกเท่านั้น ไม่ใช่ตำแหน่งจริงที่ใช้คำนวณผลลัพธ์ (อันนั้นมาจาก tracking ทุกเฟรมตามปกติ)

ส่วนที่ 2 — แก้ src/lib/surfaceDetector.ts (SurfaceTracker จาก Phase 2/7):
แก้ constructor และ detect() ให้รับ initial seed แทนพฤติกรรมเดิม:

export class SurfaceTracker {
  constructor(
    private xColumn: number,
    private columnWidth: number = 3,
    private searchMarginPx: number = 40,
    private smoothSigma: number = 2.0,
    private initialSeedY: number,              // บังคับต้องระบุเสมอ ไม่มี default เป็น "ค้นหาทั่วภาพ" อีกต่อไป
    private initialSearchMarginPx: number = 60  // margin รอบ seed สำหรับเฟรมแรกโดยเฉพาะ (กว้างกว่า searchMarginPx ปกตินิดหน่อยเผื่อผู้ใช้คลิกไม่เป๊ะ แต่ยังคงจำกัดขอบเขตอยู่ ไม่ใช่ทั่วภาพ)
  ) {}

  detect(imageData: ImageData): EdgeResult
  - ถ้า this.lastY === null (เฟรมแรก): searchRange = [initialSeedY - initialSearchMarginPx, initialSeedY + initialSearchMarginPx] แทนการค้นหาทั่วภาพแบบเดิม
  - ถ้ามี lastY แล้ว (เฟรมถัดไป): ทำงานเหมือนเดิม (searchRange รอบ lastY ด้วย searchMarginPx ปกติ)

เพิ่ม safety check ใน detect() (ทั้งเฟรมแรกและเฟรมถัดไป): ถ้า confidence ที่ได้ต่ำกว่า threshold ที่กำหนดไว้ (reuse confidence_threshold concept จาก Phase 3) ให้ยัง return ผลลัพธ์ตามปกติแต่ติด flag lowConfidence: true เพิ่มใน EdgeResult (แก้ interface EdgeResult เพิ่ม field นี้) เพื่อให้ชั้นบนเลือกทำอะไรต่อได้ (เช่นแสดงเตือนใน UI) โดยไม่ต้อง throw error กลาง pipeline

ส่วนที่ 3 — แก้ src/workers/videoProcessing.worker.ts (จาก Phase 7):
- แก้ message format ที่ initialize SurfaceTracker ให้ส่ง initialGuessPixelY ของแต่ละ point (แปลงเป็นพิกัดสัมพัทธ์กับ crop offset ให้ถูกต้องเหมือนที่ทำกับพิกัดอื่น ๆ ใน Phase 7) เข้าไปตอนสร้าง Map<pointId, SurfaceTracker> แทนการเรียก constructor แบบไม่มี seed เหมือนเดิม

ส่วนที่ 4 — แก้ src/lib/videoProcessor.ts (auto-baseline detection จาก Phase 3):
- จุดที่อ่าน 30 เฟรมแรกเพื่อหา baseline อัตโนมัติ (เมื่อ baselineValueCm เป็น null) ต้องส่ง initialGuessPixelY ของ point นั้นเข้าไปด้วยเช่นกัน ไม่ใช่ปล่อยให้ auto-baseline detection ค้นหาทั่วภาพแบบเดิม (จุดนี้สำคัญมาก เพราะ auto-baseline เป็นอีกจุดหนึ่งที่ยังมีบั๊กเดียวกันซ่อนอยู่ถ้าไม่แก้คู่กัน)

ส่วนที่ 5 — แก้ UI ที่รับผิดชอบเพิ่ม MeasurementPoint (จาก Phase 7/15):
- ตอนผู้ใช้คลิกเพิ่มจุดบน canvas ให้บันทึกตำแหน่ง y ที่คลิกจริงเป็น initialGuessPixelY ทันที (ไม่ใช่แค่ใช้คำนวณ xOffsetCm/baselineValueCm เฉย ๆ เหมือนที่ผ่านมา)
- เพิ่ม visual feedback: หลังคลิกจุด ให้วาดกรอบสี่เหลี่ยมจาง ๆ แสดง initialSearchMarginPx รอบจุดที่คลิกไว้บน canvas preview ด้วย เพื่อให้ผู้ใช้เห็นด้วยตาว่าระบบจะค้นหาผิวน้ำเฉพาะในกรอบนี้เท่านั้นในเฟรมแรก ถ้าคลิกตำแหน่งที่ผิวน้ำไม่ได้อยู่ในกรอบนี้แน่ ๆ (เช่นคลื่นสูงเกิน margin ที่ตั้งไว้) ให้ผู้ใช้ขยาย initialSearchMarginPx เอง (เพิ่ม input ปรับค่านี้ต่อจุดได้ใน UI เดียวกัน)

ส่วนที่ 6 — เพิ่มการแสดงผล lowConfidence flag (จากส่วนที่ 2) ใน LiveViewerCanvas (Phase 8):
- ถ้าเฟรมไหน detection result มี lowConfidence: true ให้เปลี่ยนสีจุด overlay ของจุดนั้นเป็นสีเตือน (เช่น เหลือง/แดงกระพริบ) แทนสีปกติของจุดนั้น ช่วยให้ผู้ใช้สังเกตเห็นช่วงที่ตรวจจับไม่มั่นใจได้ทันทีระหว่าง debug ด้วยตา

เขียน unit test ในไฟล์ src/lib/surfaceDetector.test.ts (แก้เพิ่ม):
- test ว่า SurfaceTracker กับเฟรมแรกที่มี edge แรงอยู่นอก initialSearchMarginPx (เช่น จำลอง edge ปลอมแรงมากที่ y=20 แต่ initialSeedY=150, initialSearchMarginPx=60) ต้อง**ไม่ไปติด** edge ปลอมนั้น (ตรวจว่า yPosition ที่ได้อยู่ในช่วง [150-60, 150+60] เท่านั้น ต่อให้ edge ปลอมนอกช่วงจะแรงกว่ามากแค่ไหนก็ตาม)
- test ว่าถ้า initialSeedY ใกล้เคียงตำแหน่งผิวน้ำจริง (ทดสอบด้วยภาพสังเคราะห์เหมือน Phase 2 เดิม) ระบบยัง detect ตำแหน่งถูกต้องตามปกติ (ไม่ regression พฤติกรรมที่ถูกอยู่แล้ว)
- test lowConfidence flag ทำงานถูกต้องเมื่อ confidence ต่ำกว่า threshold ที่กำหนด

รันเทสด้วย `npm run test` และทดสอบด้วยมือ (`npm run dev`) กับวิดีโอที่เจอปัญหาเดิม (ภาพที่มีไม้บรรทัด+มือถือ+หน้าต่าง contrast สูงในเฟรม): คลิกเพิ่มจุดวัดที่ตำแหน่งผิวน้ำจริงให้ครบทุกจุด แล้วรันประมวลผล เปิด LiveViewerCanvas ดูว่าจุด overlay เกาะอยู่ที่ผิวน้ำจริงตั้งแต่เฟรมแรกเลยหรือไม่ ไม่กระโดดไปที่อื่นอีกต่อไป
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด โดยเฉพาะเทส "ไม่ติด edge ปลอมนอก search margin" ต้องผ่านชัดเจน, ทดสอบด้วยมือกับวิดีโอจริงที่เจอปัญหาแล้วเห็นจุด overlay เกาะผิวน้ำตั้งแต่เฟรมแรกจริง — ถ้ายังหลุดไปที่อื่นอยู่ ให้ตรวจว่า initialGuessPixelY ถูกส่งเข้า worker ถูกต้องจริงหรือยังมีจุดไหนหลงเหลือพฤติกรรม "ค้นหาทั่วภาพ" แบบเดิมอยู่ (โดยเฉพาะจุด auto-baseline ในส่วนที่ 4 ที่มักถูกมองข้าม)

---

## Phase 17: Amplitude Bound (Real-time) + Post-hoc Outlier Filter

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 16 หรือเฟสล่าสุดที่ทำถึง) เพิ่มระบบป้องกัน tracker หลุดล็อกไปติดวัตถุอื่นที่ไม่ใช่ผิวน้ำ (เงาสะท้อน, ขีดไม้บรรทัด, ขอบวัตถุอื่นในเฟรม) ด้วยขอบเขต amplitude ที่เป็นไปได้จริงทางกายภาพ ทำงานสองชั้น: (1) ป้องกัน real-time ระหว่าง tracking ไม่ให้ lastY ขยับไปตำแหน่งที่เกินขอบเขต (2) กรอง statistical outlier หลังเก็บข้อมูลเสร็จแล้วอีกชั้น

ส่วนที่ 1 — แก้ src/lib/surfaceDetector.ts (SurfaceTracker จาก Phase 2/7/16):

แก้ EdgeResult เพิ่ม field:
  rejected: boolean;   // true ถ้าตำแหน่งที่ตรวจจับได้เฟรมนี้เกินขอบเขตที่กำหนด (ถูกปฏิเสธ ไม่นำไปอัปเดต lastY)

แก้ SurfaceTracker.detect() ให้รับ validate callback เพิ่ม:

detect(
  imageData: ImageData,
  validate?: (candidateYPosition: number) => boolean
): EdgeResult
- คำนวณ candidate (y, confidence) ตามกระบวนการเดิม (extractColumnProfile + findSurfaceEdge ภายใน searchRange ที่กำหนดจาก lastY หรือ initialSeedY ตาม Phase 16)
- ถ้ามี validate function และ validate(candidateY) คืนค่า false:
  - ตั้ง rejected = true ใน EdgeResult
  - **ไม่อัปเดต this.lastY** (คงค่าตำแหน่งดีล่าสุดไว้เหมือนเดิม ไม่ขยับไปตำแหน่งที่ถูกปฏิเสธ) — นี่คือหัวใจของการป้องกัน เพราะทำให้เฟรมถัดไปยังคงค้นหาใกล้ตำแหน่งที่เชื่อถือได้ล่าสุด ไม่ลอยตามตำแหน่งผิดไปเรื่อย ๆ
  - คืนค่า yPosition เป็น this.lastY เดิม (หรือ candidateY ถ้ายังไม่เคยมี lastY ที่ถูกต้องมาก่อนเลยตั้งแต่เฟรมแรก — กรณีนี้ให้ log คำเตือนพิเศษเพราะหมายความว่าจุดเริ่มต้นก็มีปัญหาแล้ว)
- ถ้าไม่มี validate หรือผ่านการ validate: ทำงานตามปกติ (อัปเดต lastY, rejected = false)

ส่วนที่ 2 — แก้ src/workers/videoProcessing.worker.ts (จาก Phase 7/9/16):
- แก้ message format ที่ส่งเข้า worker ต่อเฟรม ให้มี maxDeviationPx ต่อ point ด้วย (คำนวณจาก maxAmplitudeCm ที่ผู้ใช้ตั้ง คูณ pixelsPerCm ปัจจุบันของเฟรมนั้น จาก RulerCalibrationTracker — สำคัญ: ต้องคำนวณใหม่ทุกครั้งที่ pixelsPerCm เปลี่ยน ไม่ใช่ค่าคงที่ตายตัว เพราะกล้องอาจซูมเข้า-ออกได้ตาม Phase 9)
- ก่อนเรียก tracker.detect() ให้สร้าง validate closure: (candidateY) => Math.abs(candidateY - currentBaselinePixelY) <= maxDeviationPx แล้วส่งเข้า detect()
- ส่งค่า rejected กลับไปพร้อมผลลัพธ์อื่น ๆ ต่อเฟรมต่อจุด

ส่วนที่ 3 — แก้ src/lib/videoProcessor.ts:
- เพิ่ม parameter maxAmplitudeCm ใน ProcessingOptions (optional — ถ้าไม่ระบุ ปิดการป้องกันชั้นนี้ทั้งหมด ทำงานเหมือนเดิมทุกประการ เพื่อไม่ทำลาย backward compatibility)
- ส่ง maxAmplitudeCm เข้า worker ตามที่ระบุในส่วนที่ 2
- เก็บค่า rejected ต่อจุดต่อเฟรมไว้ใน WaveDataPoint ด้วย (แก้ interface เพิ่ม field rejected: boolean)

ส่วนที่ 4 — src/lib/outlierFilter.ts (ไฟล์ใหม่) — ชั้นที่ 2 กรอง statistical outlier หลังเก็บข้อมูลเสร็จ:

export interface OutlierFilterOptions {
  maxAmplitudeCm?: number;        // hard bound เดียวกับที่ใช้ตอน real-time (ใช้ซ้ำเพื่อความสอดคล้อง เผื่อมีจุดที่หลุดรอดมาจากชั้นแรก)
  medianWindowSize?: number;      // default 5 (ต้องเป็นเลขคี่)
  outlierThresholdMAD?: number;   // default 4 — ตัวคูณ median absolute deviation ที่ใช้ตัดสินว่าเป็น outlier
}

export interface OutlierFilterResult {
  filteredData: WaveDataPoint[];       // ข้อมูลหลังกรอง จุดที่ถูกตัดออกจะถูกแทนด้วยค่า linear interpolation จากจุดดีที่ใกล้ที่สุดสองข้าง
  rejectedRanges: { startS: number; endS: number }[];  // ช่วงเวลาที่ถูกตัดออก (รวม consecutive rejected points เป็นช่วงเดียวกัน) สำหรับ UI shading
  rejectedFraction: number;             // 0-1 สัดส่วนข้อมูลที่ถูกตัดทิ้งทั้งหมด
}

export function applyOutlierFilter(
  data: WaveDataPoint[],
  options: OutlierFilterOptions
): OutlierFilterResult
ขั้นตอน:
1. เริ่มจากจุดที่มี rejected: true จาก real-time layer (ชั้นที่ 1) อยู่แล้ว ให้ถือเป็น rejected ทันทีในชั้นนี้ด้วย (ไม่ต้องคำนวณซ้ำ)
2. ถ้ามี maxAmplitudeCm: mark จุดใดก็ตามที่ |elevationCm| > maxAmplitudeCm เป็น rejected เพิ่มเติม (เผื่อจุดที่หลุดรอดมาจากชั้น real-time ด้วยเหตุผลใดก็ตาม เช่นเปิดใช้ฟีเจอร์นี้ทีหลังกับข้อมูลเก่าที่ประมวลผลไปแล้วโดยยังไม่มีชั้น 1)
3. คำนวณ rolling median (window = medianWindowSize) ของสัญญาณ, คำนวณ MAD (median absolute deviation) แบบ local รอบแต่ละจุด, mark จุดที่ |value - localMedian| > outlierThresholdMAD * MAD เป็น rejected เพิ่มเติมอีก (จับ noise/spike เล็ก ๆ ที่ยังอยู่ในขอบเขต amplitude แต่ยังผิดปกติทางสถิติ)
4. รวม index ที่ถูก reject ทั้งหมดจากขั้นตอน 1-3 เป็น consecutive ranges แล้วแปลงเป็น rejectedRanges (startS, endS)
5. เติมค่าจุดที่ถูก reject ด้วย linear interpolation จากจุดดีที่ใกล้ที่สุดก่อน-หลัง (ถ้า reject อยู่ที่ขอบต้น/ท้ายสัญญาณโดยไม่มีจุดดีอีกฝั่ง ให้ใช้ค่าจุดดีที่ใกล้ที่สุดเพียงฝั่งเดียวแทน ไม่ extrapolate)
6. คำนวณ rejectedFraction = จำนวนจุดที่ reject ทั้งหมด / จำนวนจุดทั้งหมด

ส่วนที่ 5 — แก้ src/components/ProcessingPanel.tsx:
- เพิ่ม input "ขอบเขต amplitude สูงสุดที่เป็นไปได้จริง (cm)" (optional, ปิดไว้ default) พร้อม helper text อธิบายว่า "ถ้ารู้ค่าคร่าว ๆ ของคลื่นสูงสุดที่เป็นไปได้จากการตั้งค่าการทดลอง (เช่น amplitude ของ wave generator) ใส่ค่านี้เพื่อป้องกันระบบหลุดไปติดวัตถุอื่นที่ไม่ใช่ผิวน้ำ แนะนำใส่ค่าที่กว้างกว่าคลื่นจริงสัก 2-3 เท่าเผื่อไว้ ไม่ใช่ใส่ค่าตรงเป๊ะ เพราะถ้าแคบไปจะตัดคลื่นสูงจริงทิ้งด้วย"

ส่วนที่ 6 — แก้ src/components/ElevationChart.tsx และ src/components/ResultsSummary.tsx:
- ใน ElevationChart: แสดง shaded background band สีแดงจาง ๆ ในช่วงเวลาที่อยู่ใน rejectedRanges ของแต่ละจุด (ใช้ recharts ReferenceArea) เพื่อให้เห็นด้วยตาว่าช่วงไหนถูกกรองออกและแทนด้วย interpolation
- ใน ResultsSummary: เพิ่มคอลัมน์ "% ข้อมูลที่ถูกกรอง" ต่อจุดวัด (จาก rejectedFraction) ถ้าเกิน 30% ให้แสดงคำเตือนสีส้ม/แดงกำกับแถวนั้นว่า "สัดส่วนข้อมูลที่ถูกกรองสูงมาก ผลลัพธ์อาจไม่น่าเชื่อถือ แนะนำถ่ายใหม่ให้กล้องนิ่งขึ้นหรือย้ายจุดวัดให้ห่างจากวัตถุ contrast สูง"

ส่วนที่ 7 — แก้ src/lib/waveStatistics.ts (Phase 4/11) ให้ใช้ filteredData:
- ก่อนเรียก computeWaveStatistics ให้เรียก applyOutlierFilter ก่อนเสมอ (ถ้าผู้ใช้ตั้งค่า maxAmplitudeCm ไว้) แล้วส่ง filteredData เข้า computeWaveStatistics แทน raw data — สถิติคลื่นทั้งหมด (Hs, Hmax, period ทั้ง zero-crossing และ FFT จาก Phase 11) คำนวณจากข้อมูลที่กรองแล้วเสมอ ไม่ใช่ raw data ดิบ (แต่ raw data ดิบยังคงเก็บไว้ให้ดาวน์โหลดได้ตามเดิมจาก CSV export)

เขียน unit test:
- src/lib/surfaceDetector.test.ts (แก้เพิ่ม): test ว่า detect() ที่มี validate callback คืนค่า false สำหรับ candidate ที่กำหนด → rejected = true และ lastY ไม่ถูกอัปเดต (เรียก detect() ต่อเนื่องหลายครั้งด้วย candidate ที่ผิดปกติสลับกับปกติ ตรวจว่าตำแหน่งค้นหาเฟรมถัดไปยังอิงจากตำแหน่งดีล่าสุดที่ผ่านการ validate เท่านั้น ไม่ใช่ตำแหน่งที่ถูก reject)
- src/lib/outlierFilter.test.ts (ไฟล์ใหม่): 
  - test ว่าจุดที่เกิน maxAmplitudeCm ถูก mark เป็น rejected และถูกแทนด้วย interpolation ถูกต้อง (สร้างสัญญาณ sine wave ปกติ + แทรกจุด spike ผิดปกติ 2-3 จุดที่รู้ตำแหน่งแน่นอน ตรวจว่าหลัง filter แล้วค่าที่จุดนั้นใกล้เคียงค่าที่ควรจะเป็นถ้าไม่มี spike)
  - test MAD-based detection จับ noise เล็ก ๆ ที่อยู่ในขอบเขต amplitude แต่ผิดปกติทางสถิติได้ถูกต้อง
  - test rejectedRanges รวม consecutive rejected points เป็นช่วงเดียวกันถูกต้อง (ไม่ใช่แยกเป็นช่วงเล็ก ๆ ทีละจุด)
  - test edge case: จุด reject อยู่ที่ขอบต้น/ท้ายสัญญาณ (ไม่มีจุดดีอีกฝั่งให้ interpolate) ต้องใช้ค่าจุดดีที่ใกล้สุดฝั่งเดียวแทนไม่ crash

รันเทสด้วย `npm run test` และทดสอบด้วยมือ (`npm run dev`) กับวิดีโอที่เจอปัญหาเดิม (กราฟ 7 จุดที่มีปัญหาหลุดล็อก): ตั้ง maxAmplitudeCm เป็นค่ากว้าง ๆ ที่สมเหตุสมผล (เช่น 2-3cm ถ้ารู้ว่าคลื่นจริงไม่เกิน 0.5cm) รันประมวลผลใหม่ เทียบกราฟก่อน-หลังว่าไม่มี "ขั้นบันได" ค้างนิ่งผิดปกติแบบเดิมอีกต่อไป และดูสัดส่วน % ข้อมูลที่ถูกกรองต่อจุดว่าอยู่ในระดับที่ยอมรับได้หรือควรถ่ายใหม่
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด โดยเฉพาะเทสว่า `lastY` ไม่ขยับตามตำแหน่งที่ถูก reject ต้องผ่านชัดเจน (นี่คือกลไกป้องกันหลัก), ทดสอบด้วยมือกับวิดีโอจริงที่เคยมีปัญหาแล้วกราฟต้องไม่มีขั้นบันไดค้างผิดปกติแบบเดิม และเห็น shaded band ตรงตำแหน่งที่ระบบเคยหลุดล็อกชัดเจนสอดคล้องกับที่เคยเห็นปัญหา

---

## Phase 18: เครื่องมือมาร์กมือ (Manual Annotation Tool) — แยกอิสระ เรียบง่ายที่สุด

```
สร้างหน้าใหม่ในโปรเจกต์ wave-height-webapp ที่มีอยู่แล้ว: src/app/manual-mark/page.tsx

**สำคัญมาก: หน้านี้ต้องแยกอิสระจากระบบ auto detection ทั้งหมด (RulerCalibrationPanel, MeasurementPoint, worker, SurfaceTracker) ห้ามพึ่งพา component หรือ state ของระบบเหล่านั้นเลย** เพราะจุดประสงค์คือเครื่องมือมาร์กด้วยมือที่คนอ่านค่าจากไม้บรรทัดด้วยตาแล้วพิมพ์เอง ไม่ต้องมี pixel calibration ใด ๆ เลย (ตาคนที่อ่านคือตัว calibrate อยู่แล้วในตัว) — อนุญาตให้ reuse ได้เฉพาะฟังก์ชัน pure logic ที่ไม่เกี่ยวกับ pixel/calibration เช่น captureFrameAtTime (จาก Phase 3, ใช้แค่วาดเฟรมเฉย ๆ), computeWaveStatistics และ estimateDominantPeriod (จาก Phase 4/11), waveDataToCSV/downloadCSV (จาก Phase 5)

ส่วนที่ 1 — หน้าตั้งค่าก่อนเริ่มมาร์ก:
- อัปโหลดวิดีโอ (input file ธรรมดา ไม่ต้องใช้ VideoUploader component เดิมถ้าทำให้ซับซ้อนขึ้น เขียนใหม่แบบง่าย ๆ ในไฟล์นี้เลยก็ได้)
- video scrubber (เหมือน Phase 12) ให้เลื่อนหาเฟรมที่จะใช้เป็น "เวลา 0" แล้วกดปุ่ม "ตั้งเป็นเวลาเริ่มต้น (t=0)" บันทึกตำแหน่งนี้ไว้เป็น referenceTimeS
- input "ความถี่คลื่นที่ตั้งไว้ (Hz)" (optional) — ถ้ากรอก ให้คำนวณ suggestedIntervalS = (1/frequency) / 10 แสดงเป็นค่าแนะนำในช่องถัดไปโดยอัตโนมัติ (ผู้ใช้แก้เองได้ถ้าต้องการ)
- เลือกโหมด step: 
  (a) "ช่วงเวลาคงที่" — input intervalS (default ใช้ suggestedIntervalS ถ้ามี ไม่งั้น default 0.5)
  (b) "ทีละเฟรมจริง" — input videoFps (ให้ผู้ใช้กรอกเอง เช่น 30/60 เพราะเบราว์เซอร์ไม่มี API อ่าน fps จริงแม่นยำ) ระบบจะขยับทีละ 1/videoFps วินาที (บอกในคอมเมนต์ว่านี่คือค่าประมาณ ไม่ใช่เฟรมจริงเป๊ะ 100% เพราะข้อจำกัดของ browser API แต่เพียงพอสำหรับงาน manual annotation)
- ปุ่ม "เริ่มมาร์ก"

ส่วนที่ 2 — หน้าจอมาร์กหลัก (การทำงานต้อง**เร็วที่สุด**เพราะต้องทำซ้ำหลายร้อยครั้ง):
- canvas แสดงเฟรมปัจจุบัน (วาดด้วย captureFrameAtTime ที่ currentAnnotationTimeS ซึ่งเริ่มจาก referenceTimeS)
- ตัวเลขเวลาปัจจุบันแสดงใหญ่ชัดเจนเหนือ canvas (เช่น "t = 3.5s")
- input ตัวเลข (type="number" step="0.01") สำหรับกรอกค่าที่อ่านได้ (cm) — ต้อง autoFocus และ focus กลับทันทีหลังบันทึกค่าทุกครั้ง (ใช้ ref + focus() ใน useEffect หรือหลัง submit)
- เมื่อกด Enter ในช่อง input: บันทึก { timeS: currentAnnotationTimeS - referenceTimeS, valueCm: ค่าที่กรอก } ต่อท้าย array ผลลัพธ์, เพิ่ม currentAnnotationTimeS ทีละ interval ที่ตั้งไว้ (หรือ 1/videoFps ถ้าโหมดทีละเฟรม), เคลียร์ช่อง input, redraw canvas เฟรมใหม่, focus กลับที่ input ทันที — ทำทั้งหมดนี้ให้เร็วที่สุด ไม่มี delay ที่ไม่จำเป็น (คนต้องพิมพ์ค่าติดกันได้เป็นจังหวะโดยไม่รอ)
- ปุ่ม/คีย์ลัดเพิ่มเติม: 
  - "◀ ก่อนหน้า" / "ถัดไป ▶" (หรือ arrow keys) — ขยับเวลาโดยไม่บันทึกค่า สำหรับกรณีอยากดูเฟรมก่อน/หลังก่อนตัดสินใจพิมพ์ค่า
  - "↩ ย้อนกลับค่าล่าสุด" (undo) — ลบรายการล่าสุดออกจาก array และย้อน currentAnnotationTimeS กลับไปตำแหน่งก่อนหน้า (เผื่อพิมพ์ผิด)
  - "■ หยุดมาร์ก / ดูผลลัพธ์" — จบการมาร์ก ไปหน้าสรุปผล
- แสดงตารางรายการที่มาร์กไปแล้วล่าสุด 5-10 รายการด้านข้าง (time, value) ให้คลิกแถวไหนก็ได้เพื่อแก้ไขค่านั้นย้อนหลัง (คลิกแล้ว fill ค่าเดิมลงใน input ให้แก้ แล้วกด Enter บันทึกทับค่าเดิมที่ index นั้น ไม่ใช่เพิ่มรายการใหม่ต่อท้าย)
- เพิ่มกราฟเล็ก ๆ (recharts LineChart ธรรมดา) แสดงข้อมูลที่มาร์กไปแล้วแบบ real-time เป็น feedback ให้เห็นรูปคลื่นที่กำลังมาร์กอยู่คร่าว ๆ ระหว่างทำ (ไม่ต้องมี feature อะไรซับซ้อน แค่เส้นเดียวพอ)

ส่วนที่ 3 — หน้าสรุปผลลัพธ์ (หลังกด "หยุดมาร์ก"):
- เรียก computeWaveStatistics (จาก Phase 4/11, reuse โค้ดเดิม) กับข้อมูลที่มาร์กได้ทั้งหมด แสดง nWaves, hMax, hMean, hSignificant, periodMeanS (zero up-crossing)
- ถ้าข้อมูลมีจุดพอสมควร (เช่น มากกว่า 20 จุด) ให้เรียก estimateDominantPeriod (จาก Phase 11, ต้องประมาณ sampleRateHz ที่มีผลจาก intervalS ที่ใช้ตอนมาร์ก เพราะข้อมูล manual entry อาจไม่ได้ sample สม่ำเสมอเป๊ะถ้าผู้ใช้ใช้ปุ่ม ก่อนหน้า/ถัดไป ปนกับการมาร์กปกติ — ถ้า sample ไม่สม่ำเสมอให้ resampleToUniformGrid ก่อน จาก Phase 14 reuse ได้เลย) แสดง dominantPeriodS จาก FFT ด้วย
- ถ้ามีการกรอกความถี่ที่ตั้งไว้ตอนต้น: แสดงตาราง "ความถี่ที่ตั้งไว้ vs ความถี่ที่วัดได้ (ทั้งสองวิธี)" พร้อม % ผลต่าง ให้เห็นความแม่นยำทันที
- กราฟ elevation เต็มรูปแบบ (ใช้ ElevationChart component เดิมจาก Phase 5 ได้เลยถ้า reuse ง่าย เพราะรับแค่ array ธรรมดาไม่ต้องพึ่ง calibration ใด ๆ)
- ปุ่มดาวน์โหลด CSV (ใช้ waveDataToCSV/downloadCSV เดิมจาก Phase 5) — format เดียวกับ WaveDataPoint (time_s, elevation_cm) เพื่อให้เอาไปเทียบกับผลจากระบบ auto ได้ในอนาคตถ้าต้องการ (ไม่บังคับต้องเทียบตอนนี้)
- ปุ่ม "มาร์กต่อ" (กลับไปหน้ามาร์กหลัก ทำต่อจากจุดสุดท้าย ไม่รีเซ็ตข้อมูล) เผื่อกดหยุดมาแล้วอยากมาร์กเพิ่ม

ส่วนที่ 4 — เครื่องมือช่วยอ่านค่าให้ง่ายขึ้น (สำคัญสำหรับลด error จากการอ่านค่าผิด):

1. **Zoom/Crop เฉพาะบริเวณไม้บรรทัด** — หลังตั้ง referenceTimeS แล้ว เพิ่มขั้นตอน: ให้ผู้ใช้วาดกรอบสี่เหลี่ยม (drag บน canvas ที่แสดงเฟรมเต็ม) ครอบเฉพาะบริเวณไม้บรรทัด+ผิวน้ำที่จะอ่าน บันทึกเป็น readingROI = {x, y, width, height}
   - ระหว่างมาร์กหลัก (ส่วนที่ 2) แทนที่จะวาดเฟรมเต็มลง canvas ให้ crop เฉพาะ readingROI แล้ว drawImage ขยาย (scale) ให้เต็มพื้นที่ canvas ที่มีอยู่ (เช่น canvas 600x400 แต่ ROI เล็กกว่ามาก ก็ขยายให้เต็ม) — ทำให้ขีดไม้บรรทัดใหญ่ขึ้นชัดเจน อ่านง่ายขึ้นมาก
   - เพิ่มปุ่ม "ปรับกรอบใหม่" กลับไปวาดกรอบ ROI ใหม่ได้ระหว่างมาร์ก เผื่อกล้องขยับจนกรอบเดิมไม่ครอบคลุมผิวน้ำแล้ว (ไม่ต้องบ่อย แต่ต้องมีทางออกไว้)

2. **Brightness/Contrast slider** — เพิ่ม 2 slider เหนือ canvas มาร์กหลัก: brightness (ช่วง 50%-200%, default 100%) และ contrast (ช่วง 50%-200%, default 100%) ควบคุมผ่าน CSS filter บน canvas element โดยตรง (style={{ filter: \`brightness(${b}%) contrast(${c}%)\` }}) ปรับแล้วเห็นผลทันทีแบบ real-time ไม่ต้องประมวลผลภาพจริงจัง ใช้ค่าเดียวกันตลอด session (ผู้ใช้ปรับครั้งเดียวตอนเริ่มน่าจะพอ ไม่ต้องเก็บแยกต่อเฟรม)

3. **ปรับความเร็วเล่นวิดีโอ — เฉพาะตอนหาเวลาเริ่มต้นเท่านั้น** (ส่วนที่ 1, ตอน scrub หา referenceTimeS) ไม่ต้องมีในหน้ามาร์กหลัก (ส่วนที่ 2) เพราะ workflow หลักเป็นการ step ทีละจุดอยู่แล้ว ไม่ได้เล่นต่อเนื่อง — เพิ่มปุ่ม/select ความเร็ว (0.5x/1x/2x/4x) ที่ใช้ตอนกดเล่นวิดีโอผ่านคร่าว ๆ ก่อนหาจุดเริ่มต้น (video.playbackRate ธรรมดา)


- อัปโหลดวิดีโอ, scrub หาเวลาเริ่มต้น, ตั้งความถี่ที่ทราบ (ถ้ามี), เลือกโหมด step แบบเวลาคงที่, เริ่มมาร์ก
- วาดกรอบ ROI ครอบไม้บรรทัด ตรวจว่าภาพที่แสดงระหว่างมาร์กเป็นบริเวณที่ครอบไว้ขยายเต็ม canvas จริง ไม่ใช่เฟรมเต็มเหมือนเดิม
- ลองปรับ brightness/contrast slider ระหว่างมาร์ก ตรวจว่าเห็นผลทันทีบนภาพจริง
- พิมพ์ค่าติดกัน 10-15 ค่าเร็ว ๆ กด Enter รัว ๆ ตรวจว่า focus ไม่หลุดจาก input เลยสักครั้ง (ถ้า focus หลุดต้องแก้ เพราะทำลาย workflow หลักของเครื่องมือนี้)
- ทดสอบปุ่ม undo ว่าลบรายการล่าสุดและย้อนเวลาถูกต้อง
- ทดสอบคลิกแก้ไขรายการเก่าในตาราง ว่าบันทึกทับที่ index เดิมจริง ไม่สร้างรายการซ้ำ
- กด "หยุดมาร์ก" ดูหน้าสรุปผล ตรวจว่าตัวเลขสถิติสมเหตุสมผล (เทียบด้วยตากับกราฟที่เห็น)
- ถ้ากรอกความถี่ที่ตั้งไว้ ตรวจว่าตัวเลขเทียบความถี่แสดงผลถูกต้องสมเหตุสมผล
- ดาวน์โหลด CSV เปิดไฟล์ดูว่า format ถูกต้อง
```

**เกณฑ์ผ่านเฟส:** ทดสอบด้วยมือครบ checklist ข้างบน โดยเฉพาะ **workflow การพิมพ์ค่าติดกันเร็ว ๆ ต้องลื่นไม่มี focus หลุด** เพราะเป็นหัวใจของเครื่องมือนี้ทั้งหมด — ถ้าตรงนี้ไม่ลื่น เครื่องมือนี้จะช้าพอ ๆ กับไม่มีเลย

---

## หมายเหตุสำคัญเฉพาะเวอร์ชัน Client-Side

- **ความเร็วในการประมวลผล**: การ seek วิดีโอทีละเฟรมผ่าน `currentTime` มี overhead กว่าการอ่านไฟล์ตรง ๆ แบบ Python/OpenCV พอสมควร วิดีโอยาวหรือ sample rate สูงอาจใช้เวลานานในเบราว์เซอร์ — ถ้าพบว่าช้าเกินไปในทางปฏิบัติ ให้พิจารณาลด sampleRateHz ลง หรือขอ prompt เฟสเสริมสำหรับใช้ `requestVideoFrameCallback` (แม่นยำกว่าและเร็วกว่าการ seek แต่รองรับเฉพาะ Chromium-based browsers)
- **ความแม่นยำของ fps**: เบราว์เซอร์ไม่ได้ให้ค่า fps จริงของไฟล์วิดีโอเสมอไป ระบบนี้จึงให้ผู้ใช้กำหนด sampleRateHz เอง แทนที่จะพึ่งพา fps ที่อ่านจากไฟล์ — ถ้า sampleRateHz ที่ตั้งสูงกว่า fps จริงของวิดีโอ จะได้เฟรมซ้ำ ๆ กันในบางช่วง ควรตั้งให้ใกล้เคียงหรือต่ำกว่า fps จริงของไฟล์ต้นฉบับ
- **ความเป็นส่วนตัว**: ข้อดีของสถาปัตยกรรมนี้คือวิดีโอไม่ออกจากเครื่องผู้ใช้เลย เหมาะกับข้อมูลภาคสนาม/งานวิจัยที่ sensitive
- **ข้อจำกัดเบราว์เซอร์มือถือ**: มือถือบางรุ่นจำกัด memory ของ canvas/ImageData มากกว่าเดสก์ท็อป ถ้าจะรองรับมือถือด้วยควรเทสบนอุปกรณ์จริงเพิ่มเติม
