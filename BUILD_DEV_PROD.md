# การ Build และให้ Harness แก้ตัวเอง

โปรเจกต์นี้มีสอง workflow หลักสำหรับ Web: Development และ Production แต่ไม่ได้มี source tree สองชุด ทั้งสองแบบเขียน artifact ลง `lib/` และ `apps/web/dist/` ชุดเดียวกัน จึงห้ามรัน build เต็มพร้อมกับ Dev watchers

> คำสั่งในเอกสารนี้เขียนสำหรับ shell ปกติ เมื่อ Agent ทำงานตาม `AGENTS.md` ให้เติม `rtk` หน้า command ทุกครั้ง เช่น `rtk pnpm run build`

## เลือกแบบไหน

| งาน | คำสั่ง | พฤติกรรม |
| --- | --- | --- |
| แก้ UI/client ต่อเนื่อง | `pnpm run dev:web` | Build ครั้งแรก เปิด Web และ rebuild client เมื่อ source เปลี่ยน |
| เปิดจาก artifact ที่ build แล้ว | `pnpm dsh web --no-open` | เปิด Web โดยไม่ rebuild |
| ตรวจ release ของ branch นี้ | `pnpm run build` | Build native, host libraries, client libraries และ Web production bundle พร้อม Shield Break branding |

ใช้ `pnpm dsh web` จาก root ของ checkout นี้เสมอเมื่อทดสอบ branch ปัจจุบัน คำสั่ง `dsh web` ที่ติดตั้งไว้นอก repo อาจชี้ไปยัง package หรือ build เก่า

## Development workflow

เริ่มจาก root ของ repo:

```sh
pnpm install
pnpm run dev:web
```

`dev:web` ทำงานตามลำดับนี้:

1. รัน full `pnpm run build` หนึ่งครั้ง
2. เปิด TypeScript และ client bundle watchers
3. เปิด Vite dist watcher
4. เปิด `dsh web`
5. แจ้ง browser ให้ reload เมื่อ client artifact เปลี่ยน

ถ้ามี artifact ครบจาก build ก่อนหน้าแล้ว สามารถลดเวลาเริ่มต้นได้:

```sh
pnpm run dev:web -- --skip-build
```

บน Windows, network drive หรือ filesystem ที่ event watcher ไม่เสถียร ให้ใช้ polling ซึ่ง branch นี้ตั้งเป็นค่าเริ่มต้นใน `package.json` แล้ว สามารถกำหนดช่วงเองได้ด้วย `--poll=1000`

```sh
pnpm run dev:web -- --poll=1000
```

ถ้ามี `pnpm dsh web` รันอยู่แล้วและต้องการเฉพาะ watchers:

```sh
pnpm run dev:web -- --skip-build --no-serve
```

### สิ่งที่ reload อัตโนมัติ

- การแก้ client plugin, UI, CSS และ client-linked libraries จะ rebuild และ reload browser
- การเพิ่ม package ใหม่ระหว่างที่ watcher รันอยู่ต้อง restart `dev:web` เพื่อให้ค้นพบ package นั้น
- การแก้ Host, CLI, server plugin หรือ composition ฝั่ง Host ต้องหยุด process, build และเปิดใหม่ เพราะ Web server process เดิมไม่ restart ตัวเอง

สำหรับ Host change ใช้รอบนี้:

```sh
# หยุด dev:web เดิมด้วย Ctrl+C
pnpm run build
pnpm run dev:web -- --skip-build
```

ห้ามรัน `pnpm run build` หรือ build เต็มอื่นพร้อมกับ `dev:web` เพราะทุก process เขียน `lib/` และ `apps/web/dist/` เดียวกัน อาจได้ artifact คนละ revision ปะปนกัน

## Production workflow

หยุด Dev watchers และ Web instance เก่าก่อน จากนั้น:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web --no-open
```

`build` สร้าง production artifact ของ branch นี้และบันทึก environment พร้อม digest ของ client artifacts ไว้ที่ `.dsh-build/client-build-environment.json` ส่วน `pnpm dsh web` ใช้ artifact ที่มีอยู่โดยไม่ build ซ้ำ อย่าใช้ `build:official` กับ branch นี้ เพราะ profile นั้นจะแทนที่ Sidebar ด้วย DeepSeek branding

Build ไม่ใช่ deployment: มันไม่ restart service, เปลี่ยน reverse proxy หรือ migrate database การนำไปใช้จริงต้อง restart process หรือ service ที่เป็นเจ้าของ `dsh web` แยกต่างหาก

## รอบทำงานเมื่อ Harness แก้ตัวเอง

ให้ Main Agent ใช้ checklist นี้:

1. ตรวจ `git status` และเก็บงานเดิมของผู้ใช้ไว้
2. แก้ source ที่ root cause โดยไม่แก้ generated files ใน `lib/` หรือ `apps/web/dist/` โดยตรง
3. รัน targeted tests ของ package ที่แก้
4. รัน TypeScript build ของ package ที่เกี่ยวข้อง
5. ถ้าเป็น client-only change ให้ Dev watcher rebuild; ถ้าเป็น Host change ให้ restart Web process
6. ก่อนส่งมอบให้หยุด watchers แล้วรัน `pnpm run build`
7. ตรวจ `git diff --check` และยืนยันว่า build จบด้วย exit code `0`
8. เปิดด้วย `pnpm dsh web --no-open` และทำ smoke test ของ flow ที่แก้

ตัวอย่าง verification ขั้นต่ำสำหรับ Pentest/Recon packages:

```sh
pnpm exec vitest run <target-test-file>
pnpm exec tsc -b <changed-package>
pnpm run build
git diff --check
```

อย่ารัน full test suite ทุกครั้งระหว่างแก้ ให้ใช้ targeted test ก่อน แล้วรัน full gate เมื่อเปลี่ยน shared package, ก่อน merge หรือก่อน release

## ปัญหาที่พบบ่อย

### `EADDRINUSE 127.0.0.1:3080`

มี Web instance เดิมฟัง port 3080 อยู่ ตรวจ PID ให้ชัดก่อนหยุด process:

```powershell
Get-NetTCPConnection -LocalPort 3080 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
Get-Process -Id <PID>
Stop-Process -Id <PID>
```

อย่าหยุด Node processes ทั้งหมด เพราะอาจมี Agent, build หรือ session อื่นใช้งานอยู่

### แก้ source แล้วหน้า Web ไม่เปลี่ยน

- ตรวจว่า `dev:web` watcher ทุก stage ยังรันอยู่
- ถ้าใช้ `pnpm dsh web` อย่างเดียว จะไม่มี rebuild อัตโนมัติ
- Host change ต้อง restart process
- หลังสลับจาก Dev เป็น Production ให้หยุด watcher แล้วรัน `pnpm run build` ใหม่

### เปิดแล้วได้โค้ดเก่า

- ยืนยันว่าอยู่ใน root ของ checkout นี้
- ใช้ `pnpm dsh web` ไม่ใช่ global `dsh web`
- รัน `pnpm run build` หลังหยุด watchers
- ตรวจว่าไม่มี Web instance เก่าครอง port 3080

## Artifact ที่ไม่ควรแก้โดยตรง

- `packages/**/lib/`
- `apps/web/dist/`
- `.dsh-build/client-build-environment.json`
- native build outputs

ให้แก้ source และ build ใหม่เสมอ เพราะ generated artifacts จะถูกเขียนทับในรอบถัดไป
