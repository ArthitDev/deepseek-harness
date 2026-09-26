# Shield Break Agent — คู่มือ Mod และการใช้งานอย่างรับผิดชอบ

เอกสารนี้อธิบายส่วนที่ branch `shield-break-agent-v2` เพิ่มจาก DeepSeek Harness,
แนวทางนำไปใช้กับงาน Pentest และข้อจำกัดที่ต้องทราบก่อนใช้งาน

> [!CAUTION]
> เครื่องมือนี้สามารถส่งทราฟฟิกจำนวนมาก สแกนพอร์ต เรียกโปรแกรมภายนอก
> และให้โมเดลสร้างหรือรันคำสั่งได้ ใช้เฉพาะระบบที่มีหนังสืออนุญาตและระบุขอบเขตชัดเจนเท่านั้น
> การตั้ง Target หรือเลือก Team ใน UI **ไม่ใช่หลักฐานการอนุญาต** และไม่แทนข้อกำหนดทางกฎหมาย

โปรเจกต์ยังอยู่ในสถานะ developer preview ไม่ผ่านการตรวจสอบความปลอดภัยเต็มรูปแบบ
และไม่ควรถูกใช้เป็น security boundary เพียงชั้นเดียว โปรดอ่าน [Safety notice](SAFETY.md) เพิ่มเติม

## Mod ที่เพิ่มใน branch นี้

### Agent, Preset และ Sub-agent

- ปรับแบรนด์และ UI เป็น Shield Break Agent พร้อม Team mode: Blue, Red และ Black Team
- แยก Permission mode เป็น Read Only, Workspace Write และ Full access พร้อมสถานะที่เห็นชัดใน UI
- จัดการ Agent preset และ system prompt แยกตาม provider/model ได้
- กำหนดโมเดลและ preset ของ Sub-agent ได้อย่างอิสระ ไม่ต้องใช้ provider, model หรือ prompt เดียวกับ Main agent
- Dynamic Recon ใช้เส้นทาง provider/model ของ Sub-agent ที่เลือกและ preset ที่ผูกกับเส้นทางนั้น ไม่อิง Main agent โดยอัตโนมัติ
- ปรับ workflow ของ session, New Session, การลบ session และ sidebar แบบโครงสร้าง workspace/folder

Team mode ช่วยสื่อบทบาทและบริบทการทำงาน แต่ขอบเขตจริงยังขึ้นกับ Permission mode,
เครื่องมือที่เปิดให้ใช้, สิทธิ์ของ process/remote host และข้อตกลงการทดสอบ

### Full Deep Recon

Recon ใช้ profile กลางแบบ **Full Deep** เพียงแบบเดียว และสามารถสร้าง run ใหม่ให้ target เดิมได้
pipeline หลักประกอบด้วย:

- DNS, certificate transparency, TLS, HTTP, redirects และ security headers
- bounded same-origin crawl, robots, sitemap, `security.txt` และ well-known documents
- JavaScript, source-map metadata, route และ API candidate discovery
- OpenAPI/Swagger, endpoint inventory และ safe GET/OPTIONS observation
- service/port probing, banner classification และการขยาย host ที่ยังอยู่ใน scope
- แยก technology signal เป็น frontend, backend, edge, infrastructure, auth และ data store
- Findings พร้อม evidence และ CWE เมื่อ deterministic rule มี mapping ที่เชื่อถือได้
- แสดง evidence ใต้ Finding โดยตรง และย่อ/ขยาย Findings, API endpoints และส่วนผลลัพธ์อื่นได้

ถ้าตรวจไม่พบ backend ที่ยืนยันได้ ระบบจะแสดง `backend_status: not_observable`
แทนการเดา framework จาก frontend หรือ reverse proxy เช่น Next.js/OpenResty

External tools ที่รองรับแบบ optional ได้แก่ `nmap`, `subfinder` และ `nuclei` หากมีอยู่ใน execution host
โดย `nmap` phase อาจตรวจครบทุก TCP port และ `nuclei` สร้าง active network requests
จึงต้องได้รับอนุญาตแยกจาก passive OSINT อย่างชัดเจน

### AI Dynamic Recon

AI Dynamic Recon เป็นงาน Recon โดยเฉพาะ แยกจากบทสนทนาปกติ ใช้สำหรับช่องว่างที่ deterministic scan
มองไม่เห็น เช่นหน้าเว็บ dynamic หรือเส้นทางที่ต้องวิเคราะห์ตามบริบท แล้วเก็บ structured result กลับมาใช้ต่อได้

- ทำงานแบบ read-only และจำกัดการสำรวจเว็บไว้ที่ same-origin
- ห้าม submit form, login, เดารหัสผ่าน, fuzz, exploit, upload หรือเปลี่ยน state ของ target
- อ้างอิง evidence จาก Full Deep Recon และแยก observation ออกจาก finding
- แสดง provider/model และจำนวน input/output tokens เมื่อ provider ส่ง usage metadata มาให้
- ส่งข้อมูล Recon ที่เก็บแล้วไปวิเคราะห์ต่อใน Chat ได้ โดยยังควรตรวจ evidence ด้วยคน

หน้า Settings ของ Recon กำหนด allow-list ได้เฉพาะ:

```text
web_fetch, web_search, recon_get_evidence, skill, bash
```

`recon_submit_dynamic_result` เป็นเครื่องมือภายในที่ระบบผูกให้เฉพาะงาน Dynamic Recon
เพื่อส่ง structured result กลับมา **ไม่ต้องและไม่ควรเพิ่มชื่อนี้ใน allow-list**

### Queue, Result และ Evidence

- Full Deep และ AI Dynamic Recon เข้า background queue ตามลำดับ ทำให้เพิ่มงานต่อได้โดยไม่ต้องรอหน้าเดิม
- UI แสดงงานที่กำลังรันเพียงจุดเดียว และแสดง result card เมื่อ run เสร็จจริง
- รายงาน, checkpoint และ raw evidence เก็บใต้ `evidenceDir` ซึ่งค่าเริ่มต้นคือ `.recon/`
- Evidence อ่านผ่าน reference รูปแบบ `recon://<runId>/<section>` เพื่อจำกัด path ให้อยู่ใน run นั้น
- หน้า Recon เปิดดูผลเดิม เริ่ม Recon ใหม่ และกลับไป Chat ได้โดยไม่ต้องสร้างข้อความทักทายหรือ session ซ้ำเอง

## วิธีใช้งานที่แนะนำ

1. **ยืนยันสิทธิ์ก่อนเริ่ม** — ระบุ owner, target, IP/domain, environment, ช่วงเวลา,
   source IP/remote host, วิธีทดสอบที่อนุญาต, rate limit, data handling และผู้ติดต่อฉุกเฉินเป็นลายลักษณ์อักษร
2. **แยกสภาพแวดล้อม** — ใช้ VM/container หรือเครื่องสำหรับทดสอบโดยเฉพาะ สำรองข้อมูล
   และให้ process เข้าถึงไฟล์/credential เท่าที่จำเป็น
3. **เริ่มด้วยสิทธิ์ต่ำสุด** — ใช้ Read Only และ Full Deep Recon ก่อน อย่าเปิด Full access
   หรือ external tools หาก scope ไม่ได้อนุญาต
4. **ตรวจ Coverage ก่อน Findings** — อ่าน warnings, phase history และรายการ `truncated`/`partial`
   เพื่อทราบว่าส่วนใดไม่ได้ตรวจครบ
5. **ยืนยัน Evidence** — technology fingerprint, CWE และ AI finding เป็น lead ไม่ใช่ข้อพิสูจน์
   ต้องตรวจ response, header, banner หรือหลักฐานอ้างอิงก่อนรายงาน
6. **ใช้ Dynamic Recon เฉพาะช่องว่าง** — เปิดเมื่อ deterministic result ยังอธิบาย dynamic behavior ไม่ได้
   และตรวจ model, preset, tool allow-list รวมถึง token budget ก่อนรัน
7. **ส่งเข้า Chat เพื่อวิเคราะห์ ไม่ใช่ยืนยันอัตโนมัติ** — ให้ Agent ช่วยจัดลำดับความเสี่ยงหรือเสนอวิธีตรวจซ้ำ
   แต่การทดสอบที่เปลี่ยน state หรือ exploit ต้องผ่าน approval ตาม scope อีกครั้ง
8. **จัดการ Evidence เป็นข้อมูลอ่อนไหว** — ตรวจ `git status` ก่อน commit, อย่า commit `.recon/`,
   response body, endpoint ภายใน, header, token หรือข้อมูลส่วนบุคคล และลบตาม retention policy ของงาน

## การตั้งค่าที่สำคัญ

| ส่วน | ใช้กำหนด | ข้อควรระวัง |
|---|---|---|
| Agent Preset | system prompt ของแต่ละ agent | ตรวจว่า preset โหลดสำเร็จก่อนเริ่มงาน |
| Sub-agent Models | provider/model ที่ Sub-agent เลือกได้ | เป็น exact route ต่อ provider/model; ไม่ใช่ preset เดียวครอบทุกโมเดล |
| Dynamic Recon tools | allow-list ของเครื่องมือ AI Recon | เปิดเท่าที่จำเป็น; result tool ถูกผูกให้ภายใน |
| Recon budgets | page, depth, request, JS, API, host และเวลา | ถึงเพดานแล้วผลจะเป็น partial/truncated |
| Cache TTL | อายุ cache แยกตามหมวด | run ใหม่อาจใช้ observation ที่ยัง fresh; ตรวจ phase history เมื่อต้องการข้อมูลล่าสุด |
| Evidence directory | ที่เก็บ report และ raw evidence | จำกัดสิทธิ์และอย่านำขึ้น source control |
| Fingerprint overlay | signature เพิ่มเติมขององค์กร | signature ที่กว้างเกินไปทำให้เกิด false positive |
| Remote machine | host/OS ที่ใช้รันคำสั่งและ external tools | ต้องติดตั้ง tool บน host นั้นและตรวจ syntax/permission ให้ตรง OS |

## ข้อจำกัด

- Reverse proxy, CDN, WAF และ API gateway อาจซ่อน backend จริง การพบ edge technology
  ไม่ได้พิสูจน์ว่า backend ใช้ framework เดียวกัน
- Crawler ไม่ execute JavaScript ของ target และไม่ login ดังนั้น SPA route ที่สร้างตอน runtime,
  authenticated API และ state-dependent behavior อาจไม่ถูกค้นพบ
- การ probe API เป็น observation แบบปลอดภัย ไม่ใช่การยืนยันช่องโหว่ด้วย exploit
- External tool ที่ไม่ได้ติดตั้ง, PATH ต่างกัน, permission ไม่พอ หรือ remote OS ไม่รองรับ
  จะลด coverage และควรถูกแสดงเป็น warning ไม่ใช่ถือว่า target ปลอดภัย
- Network error, rate limit, timeout และ budget ทำให้รายงานเป็น partial ได้
- Recon queue เป็น process-local งานที่รอหรือกำลังรันอาจหยุดเมื่อ app restart;
  รายงานที่เสร็จแล้วจึงแยกเก็บใน evidence directory
- การ rescan target เดิมสร้าง run ใหม่ได้ แต่ per-category cache อาจนำ observation ที่ยังไม่หมด TTL มาใช้
- AI อาจตีความผิดหรือจบโดยไม่มี structured result; ใช้ evidence และการตรวจด้วยคนเป็นเกณฑ์สุดท้าย
- Token usage แสดงเฉพาะ run ใหม่และ provider ที่รายงาน usage metadata ได้ครบ
- Permission controls และ sandbox ลดความเสี่ยงแต่ไม่รับประกัน isolation
- Scope guard ป้องกันความผิดพลาดบางส่วนเท่านั้น ไม่ใช่หลักฐานสิทธิ์ตามกฎหมาย

## สิ่งที่ไม่ควรทำ

- สแกนระบบบุคคลที่สาม, cloud/shared infrastructure, CDN หรือ SaaS โดยไม่มีหนังสืออนุญาตจากเจ้าของที่เกี่ยวข้อง
- ใช้ Black/Red Team label เป็นเหตุผลแทน approval หรือขยาย scope ระหว่างงานเอง
- เปิด Full access ให้โมเดลกับเครื่องที่มี production credential, source code สำคัญ หรือข้อมูลลูกค้าโดยไม่จำเป็น
- ใช้ Dynamic Recon เป็นช่องทาง brute-force, credential attack, phishing, persistence หรือ destructive testing
- ส่ง finding จาก AI ให้ลูกค้าเป็นข้อเท็จจริงโดยไม่ยืนยันหลักฐานและผลกระทบ
- ทดสอบ production ที่ไม่มี monitoring, rate limit, backup, rollback และผู้รับผิดชอบพร้อมตอบสนอง

## รันจาก source

ต้องมี Node.js และ pnpm จาก checkout ของ branch นี้:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

สำหรับ development ที่ rebuild หน้าเว็บเมื่อ source เปลี่ยน:

```sh
pnpm run dev:web
```

ตรวจส่วน Recon แบบเจาะจงได้ด้วย:

```sh
pnpm exec vitest run packages/pentest/recon-engine/tests/recon-engine.spec.ts
pnpm exec vitest run packages/client/ui-recon/tests/recon-view.client.spec.tsx
pnpm run build:lib
```

Full test suite ใช้เวลานานกว่า targeted tests มาก ควรรันก่อน merge/release หรือหลังเปลี่ยน shared packages

## สถานะและต้นทาง

branch นี้เป็น custom modification ไม่ใช่ release ทางการของ DeepSeek Harness
เมื่อ merge upstream ต้องรักษา behavior ของ branch นี้ในจุด conflict และทดสอบ preset, session,
plugin loading, Recon queue, Dynamic Recon และ evidence flow ซ้ำทุกครั้ง

- เอกสาร upstream: [README.md](README.md)
- แนวทางความปลอดภัย upstream: [SAFETY.md](SAFETY.md)
- รายละเอียด Recon engine: [packages/pentest/recon-engine/README.md](packages/pentest/recon-engine/README.md)
- License: [MIT](LICENSE)
