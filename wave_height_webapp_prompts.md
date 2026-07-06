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

## Phase 9: Auto Re-calibration / Camera Stability Compensation

```
ทำงานต่อจากโปรเจกต์ wave-height-webapp (ต่อจาก Phase 8) เพิ่มระบบชดเชยกล้องขยับ/สั่นเล็กน้อยระหว่างถ่ายภาคสนามยาว ๆ
เป้าหมาย: ถ้ากล้องขยับไปเล็กน้อย (เช่น ลมสะเทือน ขาตั้งขยับ) ตำแหน่ง xColumn/baselineY ที่ตั้งไว้ตอนแรกจะไม่ตรงกับตำแหน่งจริงในเฟรมหลัง ๆ ทำให้ผลวัดคลาดเคลื่อน ระบบนี้ตรวจจับการขยับด้วย template matching แล้วชดเชยตำแหน่งให้ถูกต้องอัตโนมัติ

หมายเหตุ: ฟีเจอร์นี้ซับซ้อนที่สุดในระบบ ให้ implement ทีละส่วนและเทสให้แน่ใจก่อนต่อส่วนถัดไป

ส่วนที่ 1 — src/lib/stabilityTracker.ts:

export interface TemplatePatch {
  data: Float32Array;  // grayscale patch, flattened row-major
  width: number;
  height: number;
  refX: number;         // ตำแหน่ง x,y ของ patch นี้ในเฟรมอ้างอิง (เฟรมแรก)
  refY: number;
}

export function extractTemplate(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  size: number = 30
): TemplatePatch
- แปลงเป็น grayscale ตัด patch ขนาด size x size รอบจุด (centerX, centerY) (clamp ขอบภาพ)

export function normalizedCrossCorrelation(
  template: TemplatePatch,
  searchImageData: ImageData,
  searchCenterX: number,
  searchCenterY: number,
  searchRadius: number = 15
): { dx: number; dy: number; score: number }
- ทำ grayscale ของ searchImageData
- ไล่ทุกตำแหน่ง offset (dx, dy) ในช่วง -searchRadius ถึง +searchRadius รอบ (searchCenterX, searchCenterY)
- คำนวณ normalized cross-correlation score ระหว่าง template patch กับ patch ที่ตำแหน่งนั้นในภาพค้นหา (สูตรมาตรฐาน: covariance หารด้วย product ของ standard deviation ทั้งสอง patch)
- คืนค่า offset ที่ให้ score สูงสุด พร้อม score นั้น (score ใกล้ 1.0 = match ดีมาก, ใกล้ 0 หรือลบ = ไม่ match)
- Comment อธิบายความซับซ้อนเชิงคำนวณ (O(searchRadius^2 * size^2)) และเหตุผลว่าทำไมต้องจำกัด searchRadius และ size ให้เล็กพอ ไม่ให้ค้างตอนรันบน main thread (แนะนำให้ค่า default พอเหมาะ ไม่ต้องปรับ)

export class StabilityTracker {
  constructor(
    private template: TemplatePatch,
    private checkIntervalFrames: number = 30,
    private searchRadius: number = 15
  ) {}

  private frameCounter = 0
  private lastOffset = { dx: 0, dy: 0 }

  shouldCheck(): boolean
  - คืนค่า true ทุก checkIntervalFrames เฟรม (เพิ่ม frameCounter ทุกครั้งที่เรียก)

  update(imageData: ImageData): { dx: number; dy: number; score: number }
  - เรียก normalizedCrossCorrelation จากตำแหน่งอ้างอิงเดิม + lastOffset (สะสม offset ต่อเนื่อง ไม่ reset กลับไปที่ตำแหน่งอ้างอิงเดิมทุกครั้ง เพราะกล้องอาจขยับสะสมไปเรื่อย ๆ)
  - ถ้า score ที่ได้ต่ำกว่า threshold (เช่น 0.5) ให้ไม่อัปเดต lastOffset (ถือว่าหา marker ไม่เจอ อาจเพราะแสงเปลี่ยนหรือมีอะไรบังชั่วคราว) และ log คำเตือน แต่ไม่ throw error (ให้ pipeline ทำงานต่อด้วย offset เดิมที่เชื่อถือได้ล่าสุด)
  - อัปเดต lastOffset ถ้า score ผ่าน threshold แล้วคืนค่า offset ปัจจุบัน

ส่วนที่ 2 — UI สำหรับเลือก reference marker:
- src/components/MarkerSelector.tsx: ให้ผู้ใช้คลิกเลือกตำแหน่งบน canvas เฟรมแรกที่มี marker ความคมชัดสูง (เช่น มุมของไม้บรรทัด, จุดสีตัดกับพื้นหลังชัด) — แนะนำในข้อความ UI ว่าควรเลือกจุดที่นิ่ง ไม่ใช่ผิวน้ำหรือของที่เคลื่อนไหว
- แสดง preview patch ที่ตัดมา (ขยายให้ดูชัดว่า template ที่จะใช้ track คือส่วนไหนของภาพ)
- checkbox "เปิดใช้ Auto Re-calibration" (default ปิด เพราะเพิ่ม overhead การประมวลผล ควรเปิดเฉพาะกรณีที่รู้ว่ากล้องอาจขยับจริง ๆ) + input "ตรวจสอบทุก N เฟรม" (default 30)

ส่วนที่ 3 — แก้ src/lib/videoProcessor.ts:
- ถ้าเปิดใช้ auto re-calibration: หลัง captureFrameAtTime ของแต่ละเฟรม ให้ stabilityTracker.shouldCheck() ก่อน ถ้าจริงให้เรียก update() ด้วย ImageData ของเฟรมนั้น (ต้อง getImageData บริเวณรอบ marker เพิ่มจากที่ crop ไว้สำหรับจุดวัดคลื่นอยู่แล้ว หรือ getImageData ทั้งเฟรมไปเลยถ้า marker อยู่ไกลจากจุดวัด — อธิบาย trade-off นี้ในโค้ด comment)
- นำ offset (dx, dy) ที่ได้ไปปรับตำแหน่ง xColumn และ baselineY ของทุก MeasurementPoint ก่อนส่งเข้า worker คำนวณ surface detection ของเฟรมนั้น (offset เดียวกันใช้กับทุกจุดวัด เพราะสมมติว่ากล้องขยับแบบ translation รวม ไม่ได้บิดเบี้ยว/หมุน)
- ส่ง offset ปัจจุบันขึ้นไปให้ LiveViewerCanvas แสดงด้วย (เพิ่มข้อความเล็ก ๆ บน overlay บอก "Camera offset: dx=X, dy=Y" เพื่อให้ผู้ใช้เห็นว่าระบบชดเชยอยู่เท่าไหร่ ณ ขณะนั้น — เป็นข้อมูล debug ที่มีประโยชน์มาก)

เขียน unit test ในไฟล์ src/lib/stabilityTracker.test.ts:
- สร้าง ImageData ปลอมที่มี marker (จำลองด้วย pixel pattern สี่เหลี่ยมคมชัดตัดกับพื้นหลัง) ที่ตำแหน่งรู้ค่าแน่นอนในเฟรมอ้างอิง
- extractTemplate จากตำแหน่งนั้น
- สร้างเฟรมที่สองที่ marker เดียวกันขยับไปตำแหน่งใหม่ที่รู้ค่า dx, dy แน่นอน (shift ทั้งภาพหรือ shift แค่บริเวณ marker ก็ได้ ให้ตรงกับสถานการณ์จำลองกล้องขยับ)
- test ว่า normalizedCrossCorrelation หา offset ที่ตรงกับ dx, dy ที่ตั้งไว้ (error ไม่เกิน 1-2px)
- test score สูง (>0.8) เมื่อ match ดี และ score ต่ำเมื่อ marker ถูกบังหรือเปลี่ยนไปมาก (จำลองด้วย noise สุ่มทับ marker)
- test StabilityTracker.shouldCheck() คืนค่า true ตามรอบ checkIntervalFrames ที่ถูกต้อง
- test ว่า score ต่ำกว่า threshold แล้ว lastOffset ไม่ถูกอัปเดต (ค่ายังเป็นค่าก่อนหน้า)

รันเทสด้วย `npm run test` และทดสอบด้วยมือ: generate วิดีโอทดสอบที่ขยับกล้องเล็กน้อย (translate ทั้งเฟรมทีละ 1px ทุก ๆ 60 เฟรม จำลองกล้องสั่นสะสม) เทียบผลวัดความสูงคลื่นระหว่างเปิด/ปิด auto re-calibration ว่าเมื่อเปิดแล้วผลแม่นยำกว่าจริง (ค่า hSignificant ที่วัดได้ใกล้เคียงค่าจริงที่ตั้งไว้ตอน generate มากกว่าตอนปิดฟีเจอร์นี้)
```

**เกณฑ์ผ่านเฟส:** unit test ผ่านทั้งหมด, ทดสอบเทียบผลเปิด/ปิด auto re-calibration กับวิดีโอกล้องสั่นจำลองแล้วเห็นความแม่นยำดีขึ้นจริงเมื่อเปิดฟีเจอร์นี้ (ถ้าไม่เห็นความต่าง ต้องกลับไปตรวจ logic การ apply offset ใน videoProcessor.ts)

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

## หมายเหตุสำคัญเฉพาะเวอร์ชัน Client-Side

- **ความเร็วในการประมวลผล**: การ seek วิดีโอทีละเฟรมผ่าน `currentTime` มี overhead กว่าการอ่านไฟล์ตรง ๆ แบบ Python/OpenCV พอสมควร วิดีโอยาวหรือ sample rate สูงอาจใช้เวลานานในเบราว์เซอร์ — ถ้าพบว่าช้าเกินไปในทางปฏิบัติ ให้พิจารณาลด sampleRateHz ลง หรือขอ prompt เฟสเสริมสำหรับใช้ `requestVideoFrameCallback` (แม่นยำกว่าและเร็วกว่าการ seek แต่รองรับเฉพาะ Chromium-based browsers)
- **ความแม่นยำของ fps**: เบราว์เซอร์ไม่ได้ให้ค่า fps จริงของไฟล์วิดีโอเสมอไป ระบบนี้จึงให้ผู้ใช้กำหนด sampleRateHz เอง แทนที่จะพึ่งพา fps ที่อ่านจากไฟล์ — ถ้า sampleRateHz ที่ตั้งสูงกว่า fps จริงของวิดีโอ จะได้เฟรมซ้ำ ๆ กันในบางช่วง ควรตั้งให้ใกล้เคียงหรือต่ำกว่า fps จริงของไฟล์ต้นฉบับ
- **ความเป็นส่วนตัว**: ข้อดีของสถาปัตยกรรมนี้คือวิดีโอไม่ออกจากเครื่องผู้ใช้เลย เหมาะกับข้อมูลภาคสนาม/งานวิจัยที่ sensitive
- **ข้อจำกัดเบราว์เซอร์มือถือ**: มือถือบางรุ่นจำกัด memory ของ canvas/ImageData มากกว่าเดสก์ท็อป ถ้าจะรองรับมือถือด้วยควรเทสบนอุปกรณ์จริงเพิ่มเติม
