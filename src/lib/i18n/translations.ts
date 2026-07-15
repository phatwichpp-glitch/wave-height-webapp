/** Flat translation dictionary keyed by "namespace.key". English is the
 * fallback (and default) language — see LanguageProvider.tsx. Params use
 * {{name}} placeholders for simple string interpolation. */
export const translations: Record<string, { en: string; th: string }> = {
  // --- Nav ---------------------------------------------------------------
  "nav.home": { en: "Home", th: "หน้าแรก" },
  "nav.auto": { en: "Auto", th: "อัตโนมัติ" },
  "nav.manual": { en: "Manual", th: "มือ" },
  "nav.batch": { en: "Batch", th: "ชุด" },
  "nav.language": { en: "Language", th: "ภาษา" },

  // --- Shared/common -------------------------------------------------------
  "common.loadingFirstFrame": { en: "Loading first frame…", th: "กำลังโหลดเฟรมแรก…" },
  "common.videoScrubber": { en: "Video scrubber", th: "แถบเลื่อนวิดีโอ" },
  "common.play": { en: "Play", th: "เล่น" },
  "common.pause": { en: "Pause", th: "หยุดชั่วคราว" },
  "common.resume": { en: "Resume", th: "เล่นต่อ" },
  "common.reset": { en: "Reset", th: "รีเซ็ต" },
  "common.timeSuffix": { en: "{{value}}s", th: "{{value}} วิ" },
  "common.howToUse": { en: "How to use", th: "วิธีใช้" },
  "common.close": { en: "Close", th: "ปิด" },

  // --- Home ----------------------------------------------------------------
  "home.title": { en: "Wave Height Analyzer", th: "โปรแกรมวิเคราะห์ความสูงคลื่น" },
  "home.subtitle": {
    en: "Analyze wave height from a video, entirely in your browser.",
    th: "วิเคราะห์ความสูงคลื่นจากวิดีโอ ทำงานทั้งหมดในเบราว์เซอร์ของคุณ",
  },
  "home.autoTitle": { en: "Auto Detection", th: "ตรวจจับอัตโนมัติ" },
  "home.autoDescription": {
    en: "Upload a video, calibrate against a ruler, and let the app automatically track the water surface and compute wave height statistics.",
    th: "อัปโหลดวิดีโอ ปรับเทียบกับไม้บรรทัด แล้วให้โปรแกรมติดตามผิวน้ำและคำนวณสถิติความสูงคลื่นให้อัตโนมัติ",
  },
  "home.manualTitle": { en: "Manual Annotation", th: "มาร์กด้วยมือ" },
  "home.manualDescription": {
    en: "Read a ruler by eye and type values in as you watch the video — no pixel calibration needed. Useful for footage the automatic detector struggles with.",
    th: "อ่านค่าจากไม้บรรทัดด้วยตาแล้วพิมพ์ค่าไปพร้อมดูวิดีโอ — ไม่ต้องปรับเทียบพิกเซล เหมาะกับวิดีโอที่ระบบอัตโนมัติตรวจจับได้ยาก",
  },
  "home.batchTitle": { en: "Batch Processing", th: "ประมวลผลเป็นชุด" },
  "home.batchDescription": {
    en: "Process multiple videos sequentially from a JSON config, then download all results as one ZIP.",
    th: "ประมวลผลวิดีโอหลายไฟล์ต่อเนื่องจากไฟล์ config JSON แล้วดาวน์โหลดผลลัพธ์ทั้งหมดเป็น ZIP เดียว",
  },

  // --- Auto page -----------------------------------------------------------
  "auto.title": { en: "Auto Detection", th: "ตรวจจับอัตโนมัติ" },
  "auto.subtitle": {
    en: "Analyze wave height from a video, entirely in your browser.",
    th: "วิเคราะห์ความสูงคลื่นจากวิดีโอ ทำงานทั้งหมดในเบราว์เซอร์ของคุณ",
  },
  "auto.step1": { en: "Upload a video", th: "อัปโหลดวิดีโอ" },
  "auto.step2": { en: "Calibrate against a known distance", th: "ปรับเทียบกับระยะทางที่ทราบค่า" },
  "auto.step3": { en: "Configure and run processing", th: "ตั้งค่าและเริ่มประมวลผล" },
  "auto.step4": { en: "Results", th: "ผลลัพธ์" },
  "auto.fixedCamera": { en: "Fixed camera", th: "กล้องติดตั้งอยู่กับที่" },
  "auto.handheldCamera": { en: "Handheld / zooming camera", th: "กล้องถือด้วยมือ / มีการซูม" },
  "auto.statsError": {
    en: "{{label}}: could not compute wave statistics — {{message}}",
    th: "{{label}}: ไม่สามารถคำนวณสถิติคลื่นได้ — {{message}}",
  },
  "auto.spectralError": {
    en: "{{label}}: could not compute an FFT period cross-check — {{message}}",
    th: "{{label}}: ไม่สามารถคำนวณคาบเวลาแบบ FFT เพื่อตรวจสอบได้ — {{message}}",
  },

  // --- Batch page ------------------------------------------------------------
  "batch.title": { en: "Batch Processing", th: "ประมวลผลเป็นชุด" },
  "batch.subtitle": {
    en: "Process multiple videos sequentially from a JSON config, then download all results as one ZIP.",
    th: "ประมวลผลวิดีโอหลายไฟล์ต่อเนื่องจากไฟล์ config JSON แล้วดาวน์โหลดผลลัพธ์ทั้งหมดเป็น ZIP เดียว",
  },

  // --- BatchPanel ------------------------------------------------------------
  "batchPanel.selectVideoFiles": { en: "Select video files", th: "เลือกไฟล์วิดีโอ" },
  "batchPanel.configLabel": { en: "Batch config (JSON)", th: "ค่าตั้งต้นชุดงาน (JSON)" },
  "batchPanel.downloadSampleConfig": { en: "Download sample config", th: "ดาวน์โหลดตัวอย่างค่าตั้งต้น" },
  "batchPanel.configPlaceholder": {
    en: "Paste your batch config JSON here",
    th: "วางค่าตั้งต้นชุดงาน (JSON) ที่นี่",
  },
  "batchPanel.configAriaLabel": { en: "Batch config JSON", th: "ค่าตั้งต้นชุดงาน JSON" },
  "batchPanel.startProcessing": { en: "Start Batch Processing", th: "เริ่มประมวลผลเป็นชุด" },
  "batchPanel.processing": { en: "Processing…", th: "กำลังประมวลผล…" },
  "batchPanel.downloadAllResults": { en: "Download all results (.zip)", th: "ดาวน์โหลดผลลัพธ์ทั้งหมด (.zip)" },
  "batchPanel.tableFile": { en: "File", th: "ไฟล์" },
  "batchPanel.tableStatus": { en: "Status", th: "สถานะ" },
  "batchPanel.tableDetails": { en: "Details", th: "รายละเอียด" },
  "batchPanel.statusPending": { en: "pending", th: "รอดำเนินการ" },

  // --- CalibrationCanvas -----------------------------------------------------
  "calibrationCanvas.instructions": {
    en: "Scrub to a frame where the camera has settled, then click two points on a reference scale (e.g. a ruler) visible in it. Points selected: {{count}}/2",
    th: "เลื่อนไปยังเฟรมที่กล้องนิ่งแล้ว จากนั้นคลิก 2 จุดบนสเกลอ้างอิง (เช่น ไม้บรรทัด) ที่เห็นในภาพ จุดที่เลือกแล้ว: {{count}}/2",
  },
  "calibrationCanvas.knownDistance": { en: "Known distance (cm):", th: "ระยะทางที่ทราบค่า (ซม.):" },
  "calibrationCanvas.confirmCalibration": { en: "Confirm Calibration", th: "ยืนยันการปรับเทียบ" },
  "calibrationCanvas.useSavedCalibration": {
    en: "Use saved calibration ({{value}} px/cm)",
    th: "ใช้ค่าปรับเทียบที่บันทึกไว้ ({{value}} พิกเซล/ซม.)",
  },

  // --- RulerCalibrationPanel ---------------------------------------------
  "rulerCalibration.dragBox": {
    en: "Drag a box around the ruler in the frame above.",
    th: "ลากกรอบสี่เหลี่ยมล้อมรอบไม้บรรทัดในภาพด้านบน",
  },
  "rulerCalibration.clickTicks": {
    en: "Click two tick marks on the ruler inside the box, then enter each one's real value below. Ticks selected: {{count}}/2.",
    th: "คลิก 2 ขีดบนไม้บรรทัดภายในกรอบ แล้วกรอกค่าจริงของแต่ละขีดด้านล่าง ขีดที่เลือกแล้ว: {{count}}/2",
  },
  "rulerCalibration.spacingLabel": {
    en: "Spacing between adjacent ticks (cm):",
    th: "ระยะห่างระหว่างขีดที่ติดกัน (ซม.):",
  },
  "rulerCalibration.tickLabel": {
    en: "Tick {{index}} (x={{x}}, y={{y}}) real value (cm):",
    th: "ขีดที่ {{index}} (x={{x}}, y={{y}}) ค่าจริง (ซม.):",
  },
  "rulerCalibration.tickAriaLabel": {
    en: "Real value in cm for tick {{index}}",
    th: "ค่าจริงเป็นซม. สำหรับขีดที่ {{index}}",
  },
  "rulerCalibration.confirmButton": { en: "Confirm Ruler Calibration", th: "ยืนยันการปรับเทียบไม้บรรทัด" },

  // --- ProcessingPanel -----------------------------------------------------
  "processingPanel.missingBaselines": {
    en: "Every point needs a still-water baseline entered in cm before processing can start.",
    th: "ทุกจุดวัดต้องกรอกระดับน้ำนิ่งเป็นซม. ก่อนจึงจะเริ่มประมวลผลได้",
  },
  "processingPanel.invalidExpectedFrequency": {
    en: "Expected wave frequency must be a positive number, or left blank.",
    th: "ความถี่คลื่นที่คาดไว้ต้องเป็นจำนวนบวก หรือเว้นว่างไว้",
  },
  "processingPanel.invalidAnalysisStartTime": {
    en: "Analysis start time must be a number from 0 up to just before the video ends{{durationSuffix}}.",
    th: "เวลาเริ่มวิเคราะห์ต้องเป็นตัวเลขตั้งแต่ 0 ถึงก่อนวิดีโอจบ{{durationSuffix}}",
  },
  "processingPanel.invalidPlaybackRate": {
    en: "Playback rate must be a positive number.",
    th: "อัตราเล่นวิดีโอต้องเป็นจำนวนบวก",
  },
  "processingPanel.frameCallbackUnsupported": {
    en: "This browser doesn't support the Frame-callback processing mode (Chromium-based browsers only).",
    th: "เบราว์เซอร์นี้ไม่รองรับโหมดประมวลผลแบบ Frame-callback (รองรับเฉพาะเบราว์เซอร์ตระกูล Chromium)",
  },
  "processingPanel.switchToSeekBased": { en: "Switch to Seek-based", th: "เปลี่ยนไปใช้แบบ Seek-based" },
  "processingPanel.shortRemainingWarning": {
    en: "The remaining time for analysis is too short — there may not be enough data for reliable wave statistics.",
    th: "ช่วงเวลาที่เหลือสำหรับวิเคราะห์สั้นเกินไป อาจไม่พอสำหรับคำนวณสถิติคลื่นที่น่าเชื่อถือ",
  },
  "processingPanel.calibrationDriftWarning": {
    en: "Recommend choosing a calibration frame close to the actual analysis time period, for ruler ROI accuracy.",
    th: "แนะนำเลือกเฟรม calibrate ให้ใกล้เคียงกับช่วงเวลาที่จะวิเคราะห์จริง เพื่อความแม่นยำของ ROI ไม้บรรทัด",
  },
  "processingPanel.sampleRateLabel": { en: "Sample rate (Hz)", th: "อัตราสุ่มตัวอย่าง (Hz)" },
  "processingPanel.expectedFrequencyLabel": {
    en: "Expected wave frequency (Hz, optional)",
    th: "ความถี่คลื่นที่คาดไว้ (Hz, ไม่บังคับ)",
  },
  "processingPanel.expectedFrequencyAriaLabel": {
    en: "Expected wave frequency in Hz",
    th: "ความถี่คลื่นที่คาดไว้ เป็น Hz",
  },
  "processingPanel.expectedFrequencyPlaceholder": { en: "e.g. 0.4", th: "เช่น 0.4" },
  "processingPanel.analysisStartTimeLabel": { en: "Analysis start time (s)", th: "เวลาเริ่มวิเคราะห์ (วินาที)" },
  "processingPanel.analysisStartTimeAriaLabel": {
    en: "Analysis start time in seconds",
    th: "เวลาเริ่มวิเคราะห์ เป็นวินาที",
  },
  "processingPanel.processingModeLabel": { en: "Processing mode", th: "โหมดการประมวลผล" },
  "processingPanel.processingModeAriaLabel": { en: "Processing mode", th: "โหมดการประมวลผล" },
  "processingPanel.modeAuto": { en: "Auto (recommended)", th: "อัตโนมัติ (แนะนำ)" },
  "processingPanel.modeSeekBased": { en: "Seek-based (all browsers)", th: "Seek-based (ทุกเบราว์เซอร์)" },
  "processingPanel.modeFrameCallback": {
    en: "Frame-callback (fast, Chromium only)",
    th: "Frame-callback (เร็ว, เฉพาะ Chromium)",
  },
  "processingPanel.playbackRateLabel": { en: "Playback rate", th: "อัตราเล่นวิดีโอ" },
  "processingPanel.playbackRateAriaLabel": { en: "Playback rate", th: "อัตราเล่นวิดีโอ" },
  "processingPanel.startProcessing": { en: "Start Processing", th: "เริ่มประมวลผล" },
  "processingPanel.processing": { en: "Processing…", th: "กำลังประมวลผล…" },
  "processingPanel.analysisStartHint": {
    en: "Specify the second the camera becomes steady/reaches its real filming position — data before this point won't be used in the analysis.",
    th: "ระบุวินาทีที่กล้องเริ่มนิ่ง/เข้าตำแหน่งถ่ายจริง ข้อมูลก่อนหน้านี้จะไม่ถูกใช้วิเคราะห์",
  },
  "processingPanel.playbackRateHint": {
    en: "Too high a value may cause the browser to skip frames, giving too little data for high-frequency waves. Recommend checking the actual data density after processing (via confidence / data points per second) and lowering the playback rate if it's too sparse.",
    th: "ค่าสูงเกินไปอาจทำให้ browser ข้ามเฟรม ได้ข้อมูลเบาบางเกินไปสำหรับคลื่นความถี่สูง แนะนำเช็คความหนาแน่นข้อมูลที่ได้จริงหลังประมวลผล (ดูจาก confidence/จำนวนจุดข้อมูลต่อวินาที) ถ้าเบาบางเกินไปให้ลด playback rate ลง",
  },
  "processingPanel.rulerSkipped": {
    en: "Ruler re-calibration was skipped {{count}} time{{plural}} (tick fit error too high) — those stretches reused the last good scale, so check that the ruler stayed visible and in focus.",
    th: "การปรับเทียบไม้บรรทัดใหม่ถูกข้าม {{count}} ครั้ง (ค่าคลาดเคลื่อนสูงเกินไป) — ช่วงเวลานั้นใช้สเกลล่าสุดที่ยังดีอยู่แทน ลองตรวจสอบว่าไม้บรรทัดยังอยู่ในเฟรมและโฟกัสชัดตลอด",
  },
  "processingPanel.processedSummary": {
    en: "Processed {{count}} data points across {{pointCount}} measurement point{{plural}}.",
    th: "ประมวลผลข้อมูล {{count}} จุด จาก {{pointCount}} ตำแหน่งที่วัด",
  },

  // --- ProcessingControls --------------------------------------------------
  "processingControls.debugMode": {
    en: "Debug mode (slow down to see detail)",
    th: "โหมดดีบัก (ทำให้ช้าลงเพื่อดูรายละเอียด)",
  },
  "processingControls.overlayEvery": { en: "Overlay every", th: "แสดงภาพซ้อนทุก" },
  "processingControls.frames": { en: "frame(s)", th: "เฟรม" },

  // --- ElevationChart / general chart labels -------------------------------
  "chart.timeAxis": { en: "Time (s)", th: "เวลา (วินาที)" },
  "chart.elevationAxis": { en: "Elevation (cm)", th: "ระดับความสูง (ซม.)" },
  "chart.valueAxis": { en: "Value (cm)", th: "ค่า (ซม.)" },
  "chart.tooltipTime": { en: "t = {{value}}s", th: "t = {{value}} วิ" },

  // --- WaveHeightHistogram --------------------------------------------------
  "waveHeightHistogram.notEnoughData": {
    en: "Not enough waves detected to show a histogram.",
    th: "ตรวจพบคลื่นไม่พอที่จะแสดงฮิสโตแกรม",
  },
  "waveHeightHistogram.heightAxis": { en: "Wave height (cm)", th: "ความสูงคลื่น (ซม.)" },
  "waveHeightHistogram.countAxis": { en: "Count", th: "จำนวน" },
  "waveHeightHistogram.mean": { en: "Mean", th: "ค่าเฉลี่ย" },
  "waveHeightHistogram.hs": { en: "Hs", th: "Hs" },

  // --- ResultsSummary --------------------------------------------------------
  "resultsSummary.point": { en: "Point", th: "จุดวัด" },
  "resultsSummary.hs": { en: "Hs (cm)", th: "Hs (ซม.)" },
  "resultsSummary.max": { en: "Max (cm)", th: "สูงสุด (ซม.)" },
  "resultsSummary.mean": { en: "Mean (cm)", th: "เฉลี่ย (ซม.)" },
  "resultsSummary.periodCrossing": {
    en: "Period — zero up-crossing (s)",
    th: "คาบเวลา — zero up-crossing (วินาที)",
  },
  "resultsSummary.periodFft": { en: "Period — FFT (s)", th: "คาบเวลา — FFT (วินาที)" },
  "resultsSummary.notEnoughWaves": { en: "Not enough waves detected", th: "ตรวจพบคลื่นไม่พอ" },
  "resultsSummary.csv": { en: "CSV", th: "CSV" },
  "resultsSummary.downloadAllCsv": {
    en: "Download raw data — all points (CSV)",
    th: "ดาวน์โหลดข้อมูลดิบ — ทุกจุดวัด (CSV)",
  },
  "resultsSummary.downloadReport": { en: "Download summary report", th: "ดาวน์โหลดรายงานสรุป" },
  "resultsSummary.periodMismatchWarning": {
    en: "The period values from the two methods differ a lot — there may be noise or drift affecting the signal. Recommend checking the measurement point position or further reducing noise.",
    th: "ค่าคาบจาก 2 วิธีต่างกันมาก อาจมี noise หรือ drift รบกวนสัญญาณอยู่ แนะนำตรวจสอบตำแหน่งจุดวัดหรือลด noise เพิ่มเติม",
  },

  // --- PointSelector -----------------------------------------------------
  "pointSelector.showingFrame": {
    en: "Showing frame at {{value}}s — the same reference frame used for calibration, so measurement points line up with it exactly.",
    th: "แสดงเฟรมที่ {{value}} วิ — เฟรมอ้างอิงเดียวกับที่ใช้ปรับเทียบ เพื่อให้จุดวัดตรงกันพอดี",
  },
  "pointSelector.referenceFrameChanged": {
    en: "The calibration reference frame changed — previous measurement points were cleared since they may no longer match this frame. Please re-add them.",
    th: "เฟรมอ้างอิงสำหรับปรับเทียบเปลี่ยนไป — จุดวัดเดิมถูกล้างเพราะอาจไม่ตรงกับเฟรมนี้แล้ว กรุณาเพิ่มใหม่",
  },
  "pointSelector.clickToAdd": {
    en: "Click on the frame to add a measurement point ({{count}}/{{max}}).",
    th: "คลิกบนเฟรมเพื่อเพิ่มจุดวัด ({{count}}/{{max}})",
  },
  "pointSelector.baselineHint": {
    en: " Each point also needs its still-water level entered in cm below.",
    th: " แต่ละจุดต้องกรอกระดับน้ำนิ่งเป็นซม. ด้านล่างด้วย",
  },
  "pointSelector.maxReached": {
    en: "Maximum of {{max}} measurement points reached. Remove one to add another.",
    th: "ถึงจำนวนจุดวัดสูงสุด {{max}} จุดแล้ว ลบจุดใดจุดหนึ่งก่อนเพื่อเพิ่มใหม่",
  },
  "pointSelector.labelAriaLabel": {
    en: "Label for measurement point at x={{x}}",
    th: "ชื่อจุดวัดที่ x={{x}}",
  },
  "pointSelector.baselineLabel": { en: "Baseline (cm):", th: "ระดับน้ำนิ่ง (ซม.):" },
  "pointSelector.baselineAriaLabel": {
    en: "Baseline in cm for {{label}}",
    th: "ระดับน้ำนิ่งเป็นซม. สำหรับ {{label}}",
  },
  "pointSelector.searchMarginLabel": { en: "First-frame search ±px:", th: "ระยะค้นหาเฟรมแรก ±px:" },
  "pointSelector.searchMarginAriaLabel": {
    en: "First-frame search margin in pixels for {{label}}",
    th: "ระยะค้นหาเฟรมแรกเป็นพิกเซล สำหรับ {{label}}",
  },
  "pointSelector.remove": { en: "Remove", th: "ลบ" },
  "pointSelector.removeAriaLabel": { en: "Remove {{label}}", th: "ลบ {{label}}" },

  // --- Manual Mark: header/setup --------------------------------------------
  "manualMark.title": { en: "Manual Peak/Trough Annotation", th: "มาร์กจุดสูงสุด-ต่ำสุดด้วยมือ" },
  "manualMark.subtitle": {
    en: "Scrub to each wave's crest or trough by eye and save just that one point — a full cycle only needs 2 points, not a dense time series.",
    th: "เลื่อนวิดีโอหาจุดสูงสุดหรือต่ำสุดของแต่ละคลื่นด้วยตา แล้วบันทึกแค่จุดเดียว — 1 คาบคลื่นใช้แค่ 2 จุด ไม่ต้องมาร์กทุกช่วงเวลา",
  },
  "manualMark.draftFound": {
    en: "Found an unsaved draft with {{count}} points (last saved {{savedAt}}).",
    th: "พบข้อมูลมาร์กค้างไว้ {{count}} จุด (บันทึกล่าสุด {{savedAt}})",
  },
  "manualMark.restoreDraft": { en: "Restore data", th: "กู้คืนข้อมูล" },
  "manualMark.discardDraft": { en: "Start over", th: "เริ่มใหม่" },
  "manualMark.uploadVideo": { en: "Upload a video", th: "อัปโหลดวิดีโอ" },
  "manualMark.expectedFrequencyLabel": {
    en: "Expected wave frequency (Hz, optional — compared against measured results later)",
    th: "ความถี่คลื่นที่คาดไว้ (Hz, ไม่บังคับ — จะใช้เทียบกับผลที่วัดได้ภายหลัง)",
  },
  "manualMark.expectedFrequencyPlaceholder": { en: "e.g. 0.4", th: "เช่น 0.4" },
  "manualMark.readingRegionSet": { en: "Reading region set.", th: "ตั้งกรอบอ่านค่าแล้ว" },
  "manualMark.dragReadingRegion": {
    en: "Drag a box on the frame below around the ruler + water surface — this becomes the zoomed-in view used while marking.",
    th: "ลากกรอบสี่เหลี่ยมบนภาพด้านล่าง ครอบไม้บรรทัดและผิวน้ำ — กรอบนี้จะเป็นภาพซูมที่ใช้ตอนมาร์ก",
  },
  "manualMark.redrawRegion": { en: "Redraw reading region", th: "ปรับกรอบใหม่" },
  "manualMark.startMarking": { en: "Start marking", th: "เริ่มมาร์ก" },

  // --- Manual Mark: marking stage --------------------------------------------
  "manualMark.stepBack": { en: "Step back a little", th: "ถอยทีละนิด" },
  "manualMark.stepForward": { en: "Step forward a little", th: "เดินหน้าทีละนิด" },
  "manualMark.playbackSpeed": { en: "Playback speed", th: "ความเร็วเล่นวิดีโอ" },
  "manualMark.speedOption": { en: "{{value}}x", th: "{{value}}x" },
  "manualMark.brightness": { en: "Brightness", th: "ความสว่าง" },
  "manualMark.contrast": { en: "Contrast", th: "ความคมชัด" },
  "manualMark.percentValue": { en: "{{value}}%", th: "{{value}}%" },
  "manualMark.currentTime": { en: "t = {{value}}s", th: "t = {{value}} วิ" },
  "manualMark.valueAriaLabel": { en: "Reading value in cm", th: "ค่าที่อ่านได้ เป็นซม." },
  "manualMark.valuePlaceholder": { en: "Value (cm)", th: "ค่า (ซม.)" },
  "manualMark.saveCrest": { en: "▲ Save Crest", th: "▲ บันทึกจุดสูงสุด" },
  "manualMark.saveTrough": { en: "▼ Save Trough", th: "▼ บันทึกจุดต่ำสุด" },
  "manualMark.undo": { en: "↩ Undo", th: "↩ ย้อนกลับ" },
  "manualMark.toastSaved": {
    en: "Saved: t={{time}}s, {{value}}cm ({{type}})",
    th: "บันทึกแล้ว: t={{time}} วิ, {{value}} ซม. ({{type}})",
  },
  "manualMark.crest": { en: "Crest", th: "จุดสูงสุด" },
  "manualMark.trough": { en: "Trough", th: "จุดต่ำสุด" },
  "manualMark.wavesLabel": { en: "Waves: ", th: "คลื่น: " },
  "manualMark.hMeanLabel": { en: "H mean: ", th: "H เฉลี่ย: " },
  "manualMark.cm": { en: "cm", th: "ซม." },
  "manualMark.sineFitR2Label": { en: "Sine fit R²: ", th: "R² ของ sine fit: " },
  "manualMark.stopMarking": { en: "■ Stop marking / View results", th: "■ หยุดมาร์ก / ดูผลลัพธ์" },
  "manualMark.markedPoints": { en: "Marked points ({{count}})", th: "จุดที่มาร์กแล้ว ({{count}})" },
  "manualMark.emptyStateInstructions": {
    en: "Scrub the video to a wave's crest or trough, type the reading, then press C or T (or click a save button).",
    th: "เลื่อนวิดีโอหาจุดสูงสุด/ต่ำสุดของคลื่น พิมพ์ค่าที่อ่านได้ แล้วกด C หรือ T (หรือคลิกปุ่มบันทึก)",
  },
  "manualMark.deletePoint": { en: "Delete point", th: "ลบจุด" },
  "manualMark.keyboardShortcuts": { en: "Keyboard shortcuts", th: "คีย์ลัด" },
  "manualMark.shortcutFineStep": { en: "Fine step", th: "ขยับทีละนิด" },
  "manualMark.shortcutPlayPause": { en: "Play/Pause", th: "เล่น/หยุด" },

  // --- Manual Mark: summary stage --------------------------------------------
  "manualMark.results": { en: "Results", th: "ผลลัพธ์" },
  "manualMark.noPointsYet": { en: "No points marked yet.", th: "ยังไม่มีจุดที่มาร์ก" },
  "manualMark.wavesDetected": { en: "Waves detected", th: "จำนวนคลื่นที่ตรวจพบ" },
  "manualMark.hMax": { en: "H max (cm)", th: "H สูงสุด (ซม.)" },
  "manualMark.hMean": { en: "H mean (cm)", th: "H เฉลี่ย (ซม.)" },
  "manualMark.hSignificant": { en: "H significant (cm)", th: "H significant (ซม.)" },
  "manualMark.meanPeriodPairing": { en: "Mean period — pairing (s)", th: "คาบเฉลี่ย — จับคู่ (วินาที)" },
  "manualMark.method": { en: "Method", th: "วิธี" },
  "manualMark.setHz": { en: "Set (Hz)", th: "ตั้งไว้ (Hz)" },
  "manualMark.measuredHz": { en: "Measured (Hz)", th: "วัดได้ (Hz)" },
  "manualMark.difference": { en: "Difference", th: "ผลต่าง" },
  "manualMark.pairing": { en: "Pairing", th: "จับคู่" },
  "manualMark.sineFit": { en: "Sine fit", th: "Sine fit" },
  "manualMark.sineWaveFit": { en: "Sine wave fit", th: "การ fit เส้นโค้ง Sine" },
  "manualMark.needMorePointsForFit": {
    en: "Need at least 4 data points (2 cycles) to compute a sine fit.",
    th: "ต้องการอย่างน้อย 4 จุดข้อมูล (2 คาบ) ถึงจะคำนวณ sine fit ได้",
  },
  "manualMark.amplitude": { en: "Amplitude (cm)", th: "แอมพลิจูด (ซม.)" },
  "manualMark.period": { en: "Period (s)", th: "คาบเวลา (วินาที)" },
  "manualMark.frequency": { en: "Frequency (Hz)", th: "ความถี่ (Hz)" },
  "manualMark.rSquared": { en: "R²", th: "R²" },
  "manualMark.consecutiveSameTypeWarning": {
    en: "Found two {{type}} points in a row at {{time1}}s and {{time2}}s — points should always alternate between crest and trough.",
    th: "พบจุด {{type}} ติดกัน 2 จุดที่เวลา {{time1}} วิ และ {{time2}} วิ — ควรสลับ crest-trough เสมอ",
  },
  "manualMark.lowR2Warning": {
    en: "The marked waveform may not be a pure sine wave (low R²) — the sine fit result may be inaccurate. Recommend visually comparing the chart before trusting this number.",
    th: "รูปคลื่นที่มาร์กอาจไม่ใช่ sine wave บริสุทธิ์ (R² ต่ำ) ผลจาก sine fit อาจไม่แม่นยำนัก แนะนำดูกราฟเปรียบเทียบด้วยตาก่อนเชื่อตัวเลขนี้",
  },
  "manualMark.downloadCsv": { en: "Download raw data (CSV)", th: "ดาวน์โหลดข้อมูลดิบ (CSV)" },
  "manualMark.continueMarking": { en: "Continue marking", th: "มาร์กต่อ" },

  // --- Manual Mark: how-to-use modal -----------------------------------------
  "manualMark.howToUseTitle": { en: "How to use this tool", th: "วิธีใช้เครื่องมือนี้" },
  "manualMark.howToUseStep1Title": { en: "1. Upload & set up", th: "1. อัปโหลดและตั้งค่า" },
  "manualMark.howToUseStep1Body": {
    en: "Upload a video with a ruler and the water surface visible. Optionally enter the expected wave frequency to compare against later. Then drag a box around the ruler and water surface — this becomes the zoomed-in view you'll read values from while marking.",
    th: "อัปโหลดวิดีโอที่เห็นไม้บรรทัดและผิวน้ำชัดเจน กรอกความถี่คลื่นที่คาดไว้ได้ถ้าต้องการ (ไม่บังคับ) จากนั้นลากกรอบสี่เหลี่ยมครอบไม้บรรทัดและผิวน้ำ — กรอบนี้จะเป็นภาพซูมที่ใช้อ่านค่าตอนมาร์ก",
  },
  "manualMark.howToUseStep2Title": { en: "2. Find each crest and trough", th: "2. หาจุดสูงสุดและต่ำสุดของแต่ละคลื่น" },
  "manualMark.howToUseStep2Body": {
    en: "Use the scrubber, ◀◀ / ▶▶ fine-step buttons, or Play to move through the video. When the water surface is exactly at its highest point, type the value you read and press C (or click ▲ Save Crest). At the lowest point, press T (or click ▼ Save Trough). You only need 2 points per wave cycle — not a value every second.",
    th: "ใช้แถบเลื่อน ปุ่ม ◀◀/▶▶ ขยับทีละนิด หรือปุ่มเล่น เพื่อหาตำแหน่งที่ต้องการ เมื่อผิวน้ำอยู่ที่จุดสูงสุดพอดี ให้พิมพ์ค่าที่อ่านได้แล้วกด C (หรือคลิกปุ่ม ▲ บันทึกจุดสูงสุด) ที่จุดต่ำสุดให้กด T (หรือคลิกปุ่ม ▼ บันทึกจุดต่ำสุด) ใช้แค่ 2 จุดต่อ 1 คาบคลื่น ไม่ต้องมาร์กทุกวินาที",
  },
  "manualMark.howToUseStep3Title": { en: "3. Check and fix as you go", th: "3. ตรวจสอบและแก้ไขระหว่างทำ" },
  "manualMark.howToUseStep3Body": {
    en: "The list on the right always stays sorted by time — click any row to jump back to that moment, or delete it with the 🗑 button. Made a mistake on the last point? Press Ctrl+Z (or click Undo) to remove it instantly. The live chart shows the wave shape and a sine-fit curve building up as you mark more points.",
    th: "รายการด้านขวาจะเรียงตามเวลาเสมอ คลิกแถวไหนก็ย้อนกลับไปดูเวลานั้นได้ทันที หรือลบด้วยปุ่ม 🗑 ถ้าพิมพ์ผิดในจุดล่าสุด กด Ctrl+Z (หรือคลิก Undo) เพื่อลบออกทันที กราฟด้านล่างจะแสดงรูปคลื่นและเส้น sine fit ที่ค่อยๆ ชัดขึ้นเมื่อมาร์กจุดมากขึ้น",
  },
  "manualMark.howToUseStep4Title": { en: "4. Finish up", th: "4. จบงาน" },
  "manualMark.howToUseStep4Body": {
    en: "Click ■ Stop marking to see the full results: wave height statistics, a sine wave fit, and a frequency comparison if you entered an expected frequency. Download the raw data as CSV, or click Continue marking to go back and add more points.",
    th: "คลิก ■ หยุดมาร์ก เพื่อดูผลลัพธ์ทั้งหมด: สถิติความสูงคลื่น การ fit เส้นโค้ง sine และตารางเทียบความถี่ถ้ากรอกค่าที่คาดไว้ไว้ ดาวน์โหลดข้อมูลดิบเป็น CSV ได้ หรือกดมาร์กต่อเพื่อกลับไปเพิ่มจุดอีก",
  },
  "manualMark.howToUseShortcutsTitle": { en: "Keyboard shortcuts", th: "คีย์ลัด" },
  "manualMark.howToUseTip": {
    en: "Tip: your progress is auto-saved in this browser as you mark, so an accidental tab close won't lose your work — you'll be offered to restore it next time you open this page.",
    th: "เคล็ดลับ: ความคืบหน้าจะถูกบันทึกอัตโนมัติในเบราว์เซอร์ระหว่างมาร์ก ถ้าปิดแท็บพลาดก็ไม่เสียงาน — เปิดหน้านี้อีกครั้งจะมีตัวเลือกให้กู้คืนข้อมูล",
  },
};
