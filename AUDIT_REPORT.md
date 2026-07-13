# BÁO CÁO RÀ SOÁT CODEBASE — logistics-app

> Ngày rà soát: 13/07/2026. Chỉ đọc & phân tích, chưa sửa bất kỳ dòng code nào.
> Mức độ: 🔴 Cao · 🟡 Trung bình · 🟢 Thấp

---

## TÓM TẮT NHANH (đọc mục này trước)

**Vấn đề nghiêm trọng nhất của toàn bộ app: một nhóm API route hoàn toàn KHÔNG kiểm tra đăng nhập**, trong khi `src/proxy.ts` cố tình bỏ qua mọi đường dẫn `/api/*` (dòng 37). Nghĩa là **bất kỳ ai biết địa chỉ server — không cần tài khoản — đều có thể**: đọc toàn bộ danh sách lô hàng + khách hàng, sửa/tạo lô hàng, upload file tùy ý lên server, và kích hoạt đồng bộ Gmail. Tin tốt: **dữ liệu chi phí/giá vốn/lãi lỗ KHÔNG bị lộ** — mọi route `/api/costs/**` và `/api/reports/profit` đều chặn đúng chuẩn ADMIN-only ở backend (đã xác minh từng route, không phải chỉ ẩn bằng CSS).

Thứ tự nên sửa: **Mục 2.1 → 2.2 → 2.3** (khoảng 1 buổi làm việc), sau đó mới đến các mục còn lại.

---

## 1. TÍNH NĂNG CHƯA HOÀN THIỆN

### 1.1 🟡 Tự động tạo 6 task chuẩn cho lô hàng mới — CHƯA CÓ
- **File liên quan**: `src/lib/task-constants.ts` (SHIPMENT_TASK_STEPS), `src/components/shipments/TaskStepper.tsx`
- **Vấn đề**: Bạn đã yêu cầu tính năng này (chưa chốt ai là người được gán mặc định). Hiện thanh tiến trình 6 bước hiển thị trên mọi lô hàng nhưng **luôn xám toàn bộ** vì không có gì tạo 6 task đó — phải vào /tasks tạo tay từng task với tiêu đề khớp chính xác từng ký tự.
- **Đề xuất**: Hook vào `POST /api/shipments` và Gmail sync (chỗ tạo shipment mới): tạo 6 `Task` với đúng 6 tiêu đề chuẩn. Cần bạn chốt: gán cho ai (Task.assignedToUserId là trường bắt buộc).
- **Rủi ro khi sửa**: Thấp — chỉ thêm code sau khi tạo shipment; cần cân nhắc có tạo ngược cho ~400 lô hàng cũ không.

### 1.2 🟡 Sửa/Xóa công nợ — API có, UI không có
- **File**: `src/app/api/debts/[id]/route.ts` (PATCH dòng 39, DELETE dòng 96) đã viết đầy đủ; `src/app/(app)/debts/DebtsClient.tsx` và `debts/[id]/DebtDetailClient.tsx` **không có nút nào gọi tới**.
- **Vấn đề**: Nhập sai tổng tiền/hạn thanh toán là không sửa được, tạo nhầm công nợ là không xóa được (phải vào DB).
- **Đề xuất**: Thêm nút "Sửa" + "Xóa" trên trang chi tiết công nợ.
- **Rủi ro**: Không — API đã có sẵn và đã test.

### 1.3 🟡 Thanh toán (Payment) — không thể sửa/xóa ở bất kỳ đâu
- **File**: `src/app/api/debts/[id]/payments/route.ts` chỉ có POST. Không tồn tại PATCH/DELETE cho payment.
- **Vấn đề**: Ghi nhầm số tiền thanh toán là vĩnh viễn không gỡ được, và trạng thái PAID/PARTIAL tính từ payment sẽ sai theo.
- **Đề xuất**: Thêm `DELETE /api/debts/[id]/payments/[paymentId]` (nhớ tính lại `status` sau khi xóa, giống logic POST) + nút xóa trên bảng lịch sử thanh toán.
- **Rủi ro**: Thấp.

### 1.4 🟡 Sửa/Xóa nhà cung cấp (Vendor) — API có, UI không có
- **File**: `src/app/api/vendors/[id]/route.ts` (PATCH/DELETE đầy đủ); không có trang `/vendors`, `VendorCombobox` chỉ tạo mới.
- **Đề xuất**: Hoặc thêm trang quản lý NCC đơn giản, hoặc chấp nhận hiện trạng (đã ghi chú trong CLAUDE.md là chủ ý). Cần bạn quyết.
- **Rủi ro**: Không.

### 1.5 🟢 Các trang placeholder ("Module đang được xây dựng")
- `src/app/(app)/page.tsx` — **Dashboard chỉ có 1 nút** "Đi tới Quản lý lô hàng", chưa có số liệu tổng quan nào.
- `src/app/(app)/documents/page.tsx` (Kho chứng từ), `partners/page.tsx` (Đối tác), `settings/page.tsx` (Cài đặt) — placeholder thuần (partners/settings là 2 mục vừa thêm theo ảnh mẫu sidebar).
- **Không phải dead link** (đều dẫn tới trang hợp lệ), nhưng là tính năng trống. Không tìm thấy nút bấm nào "chết" thật sự trong app.

### 1.6 🟢 Chuông thông báo chỉ hiện 30 thông báo gần nhất, không có trang "xem tất cả"
- **File**: `src/app/api/notifications/route.ts`, `src/components/NotificationBell.tsx`. Badge đếm đúng quá 30, nhưng thông báo cũ hơn 30 không có cách nào đọc.

---

## 2. LỖI BẢO MẬT

### 2.1 🔴 5 nhóm API không kiểm tra đăng nhập (nghiêm trọng nhất)

`src/proxy.ts:37` — matcher `/((?!api|...).*)` **loại trừ toàn bộ /api**, và các route sau **không tự gọi `getCurrentUser()`**, nên mở hoàn toàn cho người lạ (đã xác minh bằng grep từng file):

| Route | File | Người lạ làm được gì |
|---|---|---|
| `GET /api/shipments` | `src/app/api/shipments/route.ts:6` | Đọc toàn bộ lô hàng: tên khách hàng, số tờ khai, tên hàng, URL chứng từ đính kèm |
| `POST /api/shipments` | cùng file, dòng 39 | Tạo lô hàng rác không giới hạn |
| `GET /api/shipments/[id]` | `src/app/api/shipments/[id]/route.ts:15` | Đọc chi tiết từng lô hàng (kèm `totalAmount`, ghi chú nội bộ) |
| `PATCH /api/shipments/[id]` | cùng file, dòng 34 | **Sửa dữ liệu lô hàng thật**: đổi trạng thái, ghi đè `attachments`, đổi khách hàng |
| `POST /api/upload` | `src/app/api/upload/route.ts:5` | Upload file bất kỳ lên server (xem thêm 2.2) |
| `GET /api/attachments/preview` | `src/app/api/attachments/preview/route.ts:14` | Đọc nội dung file Excel bất kỳ trong `/uploads` |
| `GET /api/gmail/auth`, `/callback`, `/status`, `POST /api/gmail/sync` | `src/app/api/gmail/*` | Kích hoạt đồng bộ, xem email đang kết nối, và **tráo mailbox**: kẻ xấu tự đi qua OAuth bằng Gmail của hắn → `callback` REPLACE row `GmailAuth` → sync từ đó đọc hộp thư của hắn thay vì của công ty |

- **Đề xuất sửa (ngắn gọn)**: Thêm 2 dòng `getCurrentUser()` + 401 vào đầu mỗi handler như mọi route khác đang làm. Gmail nên chặn thêm `role !== "ADMIN"`. Route `attachments/preview` chỉ cần check đăng nhập.
- **Rủi ro khi sửa**: **Có một chỗ cần chú ý** — comment trong `proxy.ts:33` nói việc mở `/api` là để "Gmail sync trigger" server-to-server không cần cookie. Hiện tại nút "Đồng bộ ngay" gọi từ trình duyệt (có cookie) nên thêm auth **không hỏng gì**, nhưng nếu sau này bạn định chạy sync bằng cron bên ngoài thì cần cấp một secret/token riêng cho cron. Các route shipments thêm auth xong cần test lại trang /shipments (các trang đều fetch bằng cookie trình duyệt nên sẽ vẫn chạy bình thường).

### 2.2 🔴 Upload không kiểm tra loại file, không giới hạn dung lượng
- **File**: `src/lib/save-upload.ts:8-18`, `src/app/api/upload/route.ts`
- **Vấn đề**: Nhận mọi đuôi file và lưu thẳng vào `public/uploads` (được serve tĩnh, không qua auth — `proxy.ts:37` cũng loại trừ `/uploads`). Upload file `.html` → có URL công khai chạy JavaScript trên chính domain app (**stored XSS**, đủ để đánh cắp session cookie nếu HttpOnly bị bypass qua các API mở ở 2.1 thì thậm chí không cần). Không giới hạn size → có thể ghi đầy ổ đĩa server.
- **Đề xuất**: Whitelist đuôi file (pdf, xls, xlsx, png, jpg, doc, docx...), chặn còn lại; giới hạn ~20MB; cân nhắc thêm header `Content-Disposition` khi serve.
- **Rủi ro khi sửa**: Thấp — cần rà đúng danh sách đuôi file thực tế nhân viên hay đính kèm (tờ khai .xls/.xlsx, quyết định thông quan .pdf) để không chặn nhầm.

### 2.3 🟡 File trong `/uploads` công khai với ai có URL
- **File**: `src/proxy.ts:37` (loại trừ `/uploads` khỏi check đăng nhập — comment dòng 34 giải thích là để iframe preview không bị redirect).
- **Vấn đề**: Tờ khai hải quan, hóa đơn, biên lai thanh toán... ai đoán/có được URL là tải được không cần đăng nhập. Tên file có timestamp + 8 hex ngẫu nhiên nên khó đoán mò, nhưng URL lộ qua `GET /api/shipments` không auth (2.1) thì thành lộ trọn bộ.
- **Đề xuất**: Sau khi vá 2.1 thì mức độ giảm hẳn. Về lâu dài: serve file qua một route handler có check session thay vì thư mục `public/`.
- **Rủi ro khi sửa**: Trung bình — đổi cách serve file sẽ phải sửa lại preview modal (iframe) và mọi chỗ render `attachmentUrl`.

### 2.4 ✅ Những thứ ĐÃ KIỂM TRA VÀ AN TOÀN (để bạn yên tâm)
- **Chi phí/giá vốn/lãi lỗ**: `GET/POST /api/costs` (`costs/route.ts:13-15`), `/api/costs/[costId]`, `/api/costs/audit-log`, `/api/costs/category-average`, `/api/costs/similar`, `/api/reports/profit` (`profit/route.ts:9-11`) — **tất cả đều 401 nếu chưa đăng nhập và 403 nếu không phải ADMIN, ở tầng API**, không phải ẩn bằng CSS. ACCOUNTANT gọi thẳng API cũng bị chặn. `suggest-amount` cho công nợ PAYABLE cũng đã chặn giá vốn với ACCOUNTANT (`debts/suggest-amount/route.ts`).
- **Quotes**: ADMIN+ACCOUNTANT, chặn FIELD_STAFF — đúng thiết kế.
- **Tasks**: FIELD_STAFF chỉ thấy/sửa task của mình, allowlist trường sửa được (`tasks/[id]/route.ts:17-18,36,58`).
- **Chat**: `assertMember()` chặn đọc/gửi tin của hội thoại mình không tham gia (`conversations/[id]/messages/route.ts:10-22`).
- **Notifications**: chỉ trả thông báo của chính user; PATCH có check chủ sở hữu (`notifications/[id]/route.ts:14`).
- **Không có secret hardcode** (đã grep; mọi credential đọc từ `process.env`, `.env` đã gitignore). **Không có SQL injection** (100% Prisma, không có `$queryRaw`). **XSS qua preview Excel**: `sheet_to_html` của SheetJS tự escape nội dung cell nên `dangerouslySetInnerHTML` tại `AttachmentPreviewModal.tsx:119` chấp nhận được (🟢 theo dõi thêm nếu nâng version xlsx).

---

## 3. LỖI LOGIC / DỮ LIỆU

### 3.1 🟡 `Shipment.totalAmount` (cũ) tồn tại song song với `ShipmentCost` (mới) — nguy cơ lệch số & rò rỉ khái niệm "chi phí"
- **File**: `prisma/schema.prisma:47`; hiển thị + cho sửa tại `ShipmentDetailClient.tsx` (ô "Chi phí", dòng ~286-295); nằm trong `UPDATABLE_FIELDS` của `shipments/[id]/route.ts:6`.
- **Vấn đề**: (a) Hai nguồn "chi phí" không liên quan nhau — số trên trang chi tiết lô hàng không bao giờ khớp số trên /costs; (b) trường này **mọi role đều xem và sửa được** (kể cả FIELD_STAFF), trong khi chi phí thật là ADMIN-only — dễ gây hiểu nhầm đây là giá vốn; (c) route PATCH đang không có auth (mục 2.1) nên người lạ cũng sửa được.
- **Đề xuất**: Quyết định dứt điểm: hoặc đổi nhãn thành "Chi phí (cũ, chỉ tham khảo)" + bỏ khỏi form sửa, hoặc migrate giá trị cũ vào 1 dòng `ShipmentCost` category KHAC rồi bỏ hẳn trường này.
- **Rủi ro khi sửa**: Trung bình — CLAUDE.md ghi rõ giữ read-only để không mất dữ liệu cũ; migrate cần backup trước.

### 3.2 🟡 Hai công thức "lợi nhuận" khác nhau giữa /costs và /reports/profit
- **File**: `CostsClient.tsx` (kpi `loiNhuan = Σ sellPrice − Σ costPrice`, dòng ~197-208) vs `computeProfit()` (`src/lib/shipment-cost-constants.ts:59` — `Tổng thu = báo giá mới nhất + Σ sellPrice chỉ của khoản isAdditional`).
- **Vấn đề**: Cùng một lô hàng, "Lợi nhuận tạm tính" trên /costs và "Lãi/Lỗ" trên /reports/profit ra **hai con số khác nhau**. CLAUDE.md ghi nhận "Cá nhân" là chủ ý khác công thức, nhưng thẻ "Lợi nhuận tạm tính" thì dễ bị so trực tiếp với báo cáo lãi lỗ và gây thắc mắc.
- **Đề xuất**: Ngắn gọn nhất: thêm dòng chú thích công thức dưới thẻ KPI (đã có sẵn subtitle) + đổi tên rõ hơn, HOẶC cho thẻ này dùng luôn `computeProfit()`. Cần bạn chọn.
- **Rủi ro**: Thấp (chỉ UI), nhưng nếu đổi công thức thì số liệu bạn đang quen nhìn sẽ thay đổi.

### 3.3 🟡 Xóa User đang có task/tin nhắn → lỗi 500 khó hiểu
- **File**: `src/app/api/users/[id]/route.ts:58`; schema: `Task.assignedToUserId`/`createdByUserId`, `Message.senderId`, `CostAuditLog.userId` đều là quan hệ bắt buộc không có `onDelete` (mặc định RESTRICT).
- **Vấn đề**: ADMIN xóa một nhân viên từng được gán task sẽ nhận "Không thể xóa người dùng" (500 từ lỗi FK P2003), không có hướng dẫn gì. Dữ liệu không hỏng (DB tự chặn) nhưng UX cụt.
- **Đề xuất**: Bắt lỗi P2003 trả thông báo rõ ("User còn N task/tin nhắn, hãy bàn giao trước"), hoặc làm cơ chế vô hiệu hóa (soft-disable) thay vì xóa.
- **Rủi ro**: Thấp.

### 3.4 🟡 Payment cho phép trả vượt tổng nợ, "Còn lại" thành số âm
- **File**: `src/app/api/debts/[id]/payments/route.ts` (chỉ check `amount > 0`, không check vượt `remainingAmount`).
- **Đề xuất**: Chặn `amount > remainingAmount` (hoặc cảnh báo cho xác nhận, vì thực tế có thể trả dư thật).
- **Rủi ro**: Thấp; cần hỏi nghiệp vụ: có tình huống khách chuyển dư tiền không?

### 3.5 🟢 Debt: ràng buộc customerId/vendorId theo type chỉ check ở POST, không check ở DB và PATCH
- **File**: `prisma/schema.prisma` (model Debt — có comment ghi nhận đây là chủ ý), `debts/[id]/route.ts` (PATCH cho sửa `shipmentId` nhưng không validate tồn tại → nếu gửi id rác sẽ 500 từ FK thay vì 400).
- **Đề xuất**: Validate `shipmentId` tồn tại trong PATCH; cân nhắc CHECK constraint `(type='RECEIVABLE' AND "customerId" IS NOT NULL AND "vendorId" IS NULL) OR (...)` bằng migration tay.
- **Rủi ro**: Thấp.

### 3.6 🟢 `POST /api/auth/setup` có race condition lý thuyết
- **File**: `auth/setup/route.ts:14-17` — hai request đồng thời lúc bảng User trống có thể cùng qua check `count === 0` → 2 admin. Thực tế chỉ xảy ra đúng lúc khởi tạo hệ thống, rủi ro rất thấp. Ghi nhận để biết.

### 3.7 🟢 Xóa Vendor/Customer đang gắn công nợ → nợ "mồ côi" hiển thị "—"
- Schema dùng `onDelete: SetNull` cho `Debt.customerId/vendorId` — không mất tiền, nhưng bảng công nợ sẽ có dòng không biết của ai. Đề xuất: chặn xóa vendor/customer khi còn công nợ chưa PAID.

---

## 4. HIỆU NĂNG

### 4.1 🟡 Toàn bộ schema KHÔNG có một `@@index` nào (ngoài các `@unique`)
- **File**: `prisma/schema.prisma` — grep chỉ thấy 1 `@@unique` (ConversationMember). Postgres **không tự tạo index cho cột foreign key**.
- Các cột đang được lọc/join thường xuyên mà thiếu index: `ShipmentCost.shipmentId`, `Task.relatedShipmentId` + `assignedToUserId`, `Notification.userId + isRead`, `Message.conversationId + createdAt`, `ConversationMember.userId`, `Debt.customerId/vendorId/shipmentId`, `Payment.debtId`, `CostAuditLog.shipmentId`, `Quote.shipmentId`.
- **Đề xuất**: Thêm `@@index` cho các cột trên trong 1 migration duy nhất. Ở quy mô hiện tại (trăm bản ghi) chưa thấy chậm, nhưng Message/Notification sẽ phình nhanh nhất vì chat poll 5s.
- **Rủi ro**: Gần như không — thêm index không đổi hành vi.

### 4.2 🟡 N+1 trong `GET /api/conversations`
- **File**: `src/app/api/conversations/route.ts:32-44` — mỗi conversation chạy 1 query `message.count` riêng để tính unreadCount, và `ensureCompanyConversation()` chạy đầu mỗi request. Route này bị **poll 10 giây/lần từ mọi user đang mở /messages**, nhân số query lên liên tục.
- **Đề xuất**: Gom thành 1 query `groupBy conversationId` cho unread; `ensureCompanyConversation` có thể cache theo process (chỉ cần chạy 1 lần cho tới khi có user mới).
- **Rủi ro**: Trung bình thấp — logic unread có điều kiện `lastReadAt` null, viết groupBy phải test kỹ.

### 4.3 🟢 Các trang "tải hết về client rồi lọc" (chủ ý, ghi nhận để theo dõi)
- `/shipments` (`GET /api/shipments` không phân trang, ~400 dòng), `/costs` (tải toàn bộ cost), `/debts` (toàn bộ nợ), `/reports/profit` (toàn bộ) — đều là quyết định thiết kế có ghi trong CLAUDE.md, hợp lý ở quy mô hiện tại vì KPI cần tổng toàn cục. **Ngưỡng cần xem lại**: khi shipments vượt ~2.000 dòng hoặc costs vượt ~10.000 dòng thì chuyển lọc/phân trang về server.
- `getCurrentUser()` hit DB mỗi request (kể cả poll notification 20s/lần) — chấp nhận được, có thể cache ngắn nếu sau này thấy DB load cao.
- Không tìm thấy N+1 nào khác: `task-steps-summary` đã gom 1 query, `/api/debts` include payments 1 query, reports/profit 1 query.

---

## 5. CHẤT LƯỢNG CODE

### 5.1 🟢 `formatVnd()` bị copy-paste ở **7 file**
- `CostsClient.tsx`, `DebtsClient.tsx`, `DebtDetailClient.tsx`, `ProfitReportClient.tsx`, `CostDetailPanel.tsx`, `ShipmentFinancials.tsx`, `SimilarCostsModal.tsx`.
- **Đề xuất**: Chuyển vào `src/lib/format.ts`, import chung. Kèm luôn `shipmentLabelFor()` (trùng ở CostsClient + DebtsClient) và component `KpiCard` (trùng ở CostsClient + DebtsClient).
- **Rủi ro**: Không.

### 5.2 🟢 `CostsClient.tsx` — 1.017 dòng, quá lớn
- Nên tách: modal form thêm/sửa chi phí (~200 dòng), bảng danh sách + phân trang, hàng bộ lọc. `DebtsClient.tsx` (600 dòng) tương tự với modal thêm công nợ.
- **Rủi ro**: Trung bình — file này đã qua nhiều vòng chỉnh theo yêu cầu của bạn, tách phải cẩn thận không đổi hành vi (đặc biệt logic "submit xong giữ modal mở, reset một phần form").

### 5.3 🟢 Khối xử lý lỗi Prisma (P2025/P2002) lặp ở hầu hết route
- Có thể gom thành helper `handlePrismaError(error, entityLabel)` trong `api-response.ts`. Không gấp.

---

## PHỤ LỤC — THỨ TỰ SỬA ĐỀ XUẤT

| # | Việc | Mức độ | Ước lượng |
|---|---|---|---|
| 1 | Thêm auth vào 11 route hở (mục 2.1) | 🔴 | ~1 giờ + test |
| 2 | Whitelist loại file + giới hạn size upload (2.2) | 🔴 | ~30 phút |
| 3 | Bắt lỗi FK khi xóa user, validate shipmentId ở PATCH debts (3.3, 3.5) | 🟡 | ~30 phút |
| 4 | Migration thêm index (4.1) | 🟡 | ~30 phút |
| 5 | Quyết định số phận `totalAmount` (3.1) — **cần bạn chọn phương án** | 🟡 | tùy phương án |
| 6 | Gom unreadCount 1 query (4.2) | 🟡 | ~45 phút |
| 7 | Nút Sửa/Xóa công nợ + Xóa payment (1.2, 1.3) | 🟡 | ~1-2 giờ |
| 8 | Auto-tạo 6 task chuẩn (1.1) — **cần bạn chốt người được gán** | 🟡 | ~1 giờ |
| 9 | Dọn code trùng, tách file lớn (5.x) | 🟢 | khi rảnh |
