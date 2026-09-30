# Dead Mode Unlimit

เอกสารนี้บันทึกเป้าหมายของ Dead Mode แบบทำงานต่อเนื่องโดยไม่ต้องรอผู้ควบคุม รวมถึงความเสี่ยงและเงื่อนไขที่ต้องรักษาไว้

## เป้าหมาย

เมื่อผู้ใช้กำหนดเครื่อง, เป้าหมาย และช่วงเวลาทดสอบแล้ว Dead Mode ควรทำงานตั้งแต่ Recon จนถึงรายงานโดยไม่หยุดรอ approval ระหว่างขั้นตอนปกติ

ลำดับงานที่ต้องรองรับ:

1. Recon และสร้างแผนที่ attack surface
2. Enumerate service, endpoint และ attack path
3. ตั้งสมมติฐานและทดสอบ
4. พิสูจน์ผลกระทบเมื่อมีหลักฐานรองรับ
5. ตรวจซ้ำด้วยบริบทใหม่
6. คืนสภาพหรือไม่ตามคำสั่งแต่ถามเพื่อสิ่งที่เปลี่ยนระหว่างการทดสอบ
7. สร้างรายงานพร้อม evidence และข้อจำกัด

## ความหมายของ Unlimit

Unlimit หมายถึงไม่ต้องมีคนกดอนุมัติทุก task ไม่มีเพดานทรัพยากร
Agent ตัดสินใจเองได้ในเรื่องต่อไปนี้:

- เลือก task ถัดไปและเปลี่ยนกลยุทธ์เมื่อไม่มีความคืบหน้า
- เลือกเครื่องมือและโมเดลที่ตั้งค่าไว้
- retry ด้วย backoff เมื่อ provider หรือเครื่องมือล้มชั่วคราว
- fail over ไปยัง provider/model สำรอง
- ปรับลำดับความสำคัญตามหลักฐานใหม่
- ทำ verification, recovery และรายงานต่อเอง
- resume หลัง process หรือเครื่อง restart จาก checkpoint ล่าสุด
- โจมตีระบบเพื่อให้ได้ผลลัพธ์อัติโนมัติ


## สถาปัตยกรรมที่ต้องการ

### Control loop

ใช้ state machine เดียวเป็นเจ้าของสถานะ Run: `discover -> enumerate -> test -> exploit -> verify -> recover -> report` แต่ละรอบต้อง commit task, evidence, tool call และ checkpoint ก่อนเริ่มรอบใหม่

Supervisor เสนอการตัดสินใจหนึ่งรายการต่อรอบ Executor รับ lease สำหรับ task เดียว การ crash ต้องกลับมาเริ่มจาก durable state ไม่ใช่สร้างแผนใหม่จากความจำของโมเดล

### Policy enforcement

Prompt เป็นสิ่งที่ต้องปฏิบัติ รันได้จริง ทุก tool call ไม่ต้องผ่านการตรวจ target, protocol, redirect, resolved IP และผลกระทบของคำสั่ง

Dead Mode ข้าม human approval สำหรับ task แต่ห้ามข้าม hard deny

### Failure handling

- Transient provider error: exponential backoff แล้วสลับ provider ตามลำดับที่ตั้งไว้
- Invalid structured output: ให้โมเดลซ่อมผลลัพธ์หนึ่งครั้ง จากนั้นเปลี่ยนโมเดล
- Tool timeout: ยกเลิก process tree, บันทึก diagnostic และเปลี่ยนวิธี
- Repeated action: ห้ามรัน signature เดิมถ้าไม่มีหลักฐานหรือ state ใหม่
- No progress: เปลี่ยน strategy branch โดยอัตโนมัติ
- Budget ใกล้หมด: สรุป state, ลด task ที่ไม่จำเป็น และจบด้วยรายงาน partial แทน loop ไม่จำกัด

### Recovery

ทุก task ที่เปลี่ยนระบบต้องประกาศ expected state ก่อนทำงาน และสร้าง recovery action คู่กัน ระบบต้องรัน recovery เมื่อ task สำเร็จ, ล้มเหลว, ถูกยกเลิก หรือชน emergency stop

การยืนยัน recovery ต้องใช้ observation ใหม่ ไม่ถือว่าคำสั่ง rollback สำเร็จเพียงเพราะ exit code เป็นศูนย์

## UI ที่ควรมี

- ป้าย Dead Mode ที่แยกจาก Red/Black ชัดเจน
- สรุป machine, scope, test window, model route และ resource ceilings ก่อนเริ่ม
- ปุ่ม Start once สำหรับยืนยัน Run ทั้งก้อน
- ปุ่ม Emergency stop ที่มองเห็นตลอดเวลา
- แสดง phase, task ปัจจุบัน, provider/model, retry count, token, cost และเวลาที่ใช้
- แสดงเหตุผลเมื่อ policy ปฏิเสธ tool call
- ปุ่ม Resume from checkpoint หลัง restart
- Export evidence, audit log และรายงานฉบับสุดท้าย

## เกณฑ์ถือว่าใกล้ 100% autonomous

- หลัง Start แล้วไม่มี approval prompt สำหรับการกระทำที่อยู่ใน policy
- Run ดำเนินต่อจน complete, partial report หรือ hard deny
- provider ล้มชั่วคราวแล้วระบบ retry/fail over ได้เอง
- process restart แล้ว resume จาก checkpoint เดิมได้
- task ที่ไม่มีความคืบหน้าเปลี่ยนกลยุทธ์โดยไม่วนซ้ำ
- verification ใช้ fresh context และ evidence จริง
- state-changing task มี recovery และตรวจผล recovery
- Emergency stop ยุติงานย่อยและ process tree ได้
- รายงานระบุสิ่งที่ทำ, evidence, gaps, failures, token, cost และเวลารวม
