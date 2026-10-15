# devkit.

Website local dành cho developer và QC, hỗ trợ Firebase DebugView, upload Crashlytics native symbols và mở Android Device Monitor. Giao diện tiếng Việt, responsive, có tìm kiếm Ctrl+K, sáng/tối, lịch sử thao tác và log thực thi.

## Chạy

Yêu cầu **Node.js 20+**. Không cần cài dependency.

```powershell
cd D:\dev-support
npm start
```

Mở **http://localhost:3210**. Chạy `npm run dev` để Node tự khởi động lại khi sửa backend; tải lại trình duyệt sau khi sửa frontend. Đổi port bằng `$env:PORT = '4000'` trước khi chạy.

Chỉ chạy một trong hai lệnh `npm start` hoặc `npm run dev` trên cùng cổng. Nếu cổng 3210 đã được sử dụng, mở trang đang chạy tại địa chỉ trên, hoặc nhấn Ctrl+C ở terminal chạy phiên cũ rồi khởi động lại. Khi dùng `npm run dev`, nhấn Ctrl+C để thoát cả chế độ watch trước khi chạy lệnh khác. Có thể chọn cổng khác trong PowerShell:

```powershell
$env:PORT = '3211'
npm start
```

Khi đó mở **http://localhost:3211**. Server sẽ báo rõ khi trùng cổng và giữ nguyên tiến trình đang sử dụng cổng đó.

## Cấu hình công cụ

- **ADB:** Cài Android SDK Platform Tools. Devkit tự tìm qua `ANDROID_SDK_ROOT`, `ANDROID_HOME`, Android SDK mặc định, SDK đi kèm Unity Hub trên Windows và `PATH`. Có thể ghi đè Android SDK root hoặc đường dẫn `adb.exe` trong **Cài đặt**. Bật USB debugging và cấp quyền trên điện thoại. Khi có nhiều thiết bị, chọn đúng thiết bị trước khi chạy.
- **Firebase CLI:** Cài `npm install -g firebase-tools`, sau đó chạy `firebase login` trong terminal bằng cùng tài khoản Windows đang chạy server. Có thể đặt đường dẫn `firebase.cmd` hoặc `firebase.js` trong Cài đặt. Tài khoản cần quyền upload symbols cho Firebase app đã chọn. Việc phát hiện CLI chưa đồng nghĩa đã đăng nhập.
- **Android Monitor:** Cần **Windows**, Android SDK Tools cũ có `tools/monitor.bat` và phiên bản Java tương thích. SDK mới đã loại bỏ công cụ này. Chọn SDK root phù hợp trong Cài đặt. Tùy chọn Administrator dùng `Start-Process -Verb RunAs -WindowStyle Hidden`; Windows có thể yêu cầu chấp nhận UAC. Kết quả thành công xác nhận đã gửi yêu cầu mở tiến trình, không xác nhận GUI Java đã khởi động hoàn tất.

## Các thao tác

**Firebase DebugView** có sẵn lựa chọn mặc định **Dancing Road** với package `com.amanotes.pamadancingroad`. Chọn **Ứng dụng khác** để nhập package riêng. Ứng dụng ghi nhớ lựa chọn trên trình duyệt và giữ lại package tùy chỉnh đã lưu từ trước. Lệnh dùng thiết bị đã chọn:

```text
adb -s DEVICE_SERIAL shell setprop debug.firebase.analytics.app PACKAGE_NAME
adb -s DEVICE_SERIAL shell setprop debug.firebase.analytics.app .none.
```

Sau mỗi thao tác, server đọc lại thuộc tính bằng `getprop` để xác nhận. Xem sự kiện trong Firebase Console → Analytics → DebugView.

**Upload symbols:** App ID mặc định là `1:528923424982:android:46195f809d709f94`. Nhập App ID, kéo thả hoặc chọn một file `.zip` tối đa 1 GB rồi nhấn Upload. Trình duyệt chuyển file đến backend local; backend thực thi:

```text
firebase crashlytics:symbols:upload --app=APP_ID "LOCAL_TEMP_FILE.zip" --non-interactive
```

Thanh tiến độ thể hiện bước chuyển file đến backend. Quá trình Firebase upload được theo dõi qua log và trạng thái tác vụ. File tạm được xóa sau khi CLI kết thúc, kể cả khi thất bại. Cần dùng native symbols phù hợp với đúng bản build; file ZIP có chữ ký hợp lệ vẫn có thể bị Firebase từ chối nếu không có symbols hợp lệ.

## Đọc & định dạng JSON

Mở **Đọc & định dạng JSON** từ menu hoặc trang Tổng quan. Không gian làm việc gồm 3 cột: nội dung gốc, JSON đã định dạng và cây thông tin dễ đọc. Trên màn hình nhỏ, các cột tự xuống hàng.

- Dán nội dung, mở file hoặc kéo thả một file JSON tối đa **5 MB**. Có ví dụ Dancing Road để dùng thử.
- Thụt lề **2 dấu cách**, **4 dấu cách**, **tab**, hoặc **thu gọn một dòng**; sắp xếp tên trường ở mọi cấp; Unicode giữ nguyên hoặc chuyển thành `\uXXXX`; xuống dòng LF hoặc CRLF. Tùy chọn CRLF được giữ khi sao chép/tải file.
- Có thể sửa trực tiếp ở cả cột JSON gốc và cột đã định dạng. Khi gõ ở cột 2, nội dung gốc được đồng bộ; con trỏ và nội dung đang gõ được giữ nguyên, kể cả JSON chưa hợp lệ. Cây thông tin và chức năng sao chép/tải xuống chỉ sẵn sàng khi JSON hợp lệ. Nhấn **Định dạng** để áp dụng lại kiểu trình bày đã chọn.
- Ở cột thông tin, bấm **Sửa** tại trường hoặc nhóm để đổi tên trường, kiểu dữ liệu và giá trị. Văn bản nhập trực tiếp; nhóm/danh sách nhập dạng JSON. **Lưu** kiểm tra dữ liệu rồi cập nhật cả 3 cột; **Hủy** hoặc Esc bỏ phần đang sửa. Hoạt động cả khi phóng to.
- Tự động định dạng sau khi nhập hoặc nhấn **Định dạng** khi tắt tự động. JSON sai được báo dòng/cột; kết quả cũ bị xóa để tránh dùng nhầm.
- Hai cột mã JSON có màu riêng cho tên trường, văn bản, số, boolean và null; ngoặc và đường thụt lề đổi màu theo cấp lồng nhau. Có số dòng và làm nổi bật cặp ngoặc khi đặt con trỏ cạnh ngoặc. Hoạt động ở giao diện sáng/tối và khi phóng to; không thay đổi dữ liệu hoặc nội dung sao chép/tải xuống. Lớp màu chỉ dựng các dòng đang xem để giữ giao diện nhẹ; dòng thu gọn quá dài có giới hạn số token được tô cùng lúc.
- Mỗi cột có nút **Phóng to** để mở cửa sổ rộng gần toàn màn hình. Vẫn có thể sửa nội dung gốc, sao chép/tải kết quả hoặc mở/thu nhóm thông tin trong cửa sổ này. Nhấn **Thu nhỏ** hoặc **Esc** để trở lại 3 cột; nội dung được giữ nguyên.
- Cây thông tin có thể mở/thu từng nhóm, hiển thị loại dữ liệu và số phần tử. Nhóm lớn tải thêm 50 mục mỗi lần; văn bản dài chỉ xem trước 2.000 ký tự ở cây, bản JSON vẫn giữ toàn bộ nội dung.
- Giữ nguyên biểu diễn số (kể cả ID dài), thứ tự phần tử mảng và các tên trường trùng. Tên trường trùng có cảnh báo. Hỗ trợ JSON chuẩn; không tự sửa JSON sai, không hỗ trợ comment hoặc dấu phẩy cuối.
- Sao chép hoặc tải file `.json`. Dữ liệu chỉ nằm trong bộ nhớ trang, không gửi lên backend, không lưu history/localStorage; tải lại trang sẽ xóa nội dung. Giới hạn lồng nhau 128 cấp, kết quả tối đa 20 MB.

Sau khi cập nhật phiên bản có công cụ JSON, khởi động lại backend để nạp đường dẫn phục vụ hai module JavaScript mới, rồi tải lại trình duyệt.

## Xem bảng CSV

Mở **Xem bảng CSV** từ menu hoặc trang Tổng quan. Chọn/kéo thả file `.csv`, `.tsv`, hoặc mở **Dán nội dung CSV** rồi nhấn **Xem bảng**. Có ví dụ Dancing Road để dùng thử.

- Nhận diện tự động dấu phẩy, chấm phẩy, tab hoặc gạch đứng; có thể chọn lại bằng tay. Đọc được dòng `sep=;` của Excel, dấu ngoặc kép kép và ô có xuống dòng.
- Bảng mã mặc định nhận diện UTF-8 và BOM của UTF-16 LE/BE. Có lựa chọn UTF-8, UTF-16 LE/BE, Windows-1252 và Windows-1258. Tùy chọn encoding áp dụng cho file, nội dung dán đã là văn bản Unicode.
- Bật/tắt dòng đầu là tiêu đề và bỏ qua dòng trống. Dòng có số ô khác nhau được cảnh báo, giữ toàn bộ ô thừa và để trống vị trí thiếu.
- Tìm trong toàn bộ dữ liệu, hỗ trợ tìm tiếng Việt không dấu. Bấm tiêu đề cột để sắp xếp tăng/giảm; thứ tự sắp xếp tự nhiên theo văn bản. Giá trị vẫn là chuỗi, giữ số 0 đầu, ID dài và nội dung bắt đầu bằng dấu `=`.
- Chọn 50/100/250 dòng mỗi trang; bảng giữ tối đa 10.000 ô trên một trang khi có nhiều cột. Tiêu đề và số dòng được giữ khi cuộn. Bấm vào ô để xem/sao chép toàn bộ nội dung hoặc **Phóng to bảng**, nhấn Esc để thu nhỏ.
- Giới hạn file/nội dung 10 MB, 100.000 bản ghi (gồm tiêu đề), 1.000 cột và 1.000.000 ô. Khi vượt giới hạn, công cụ báo lỗi thay vì cắt dữ liệu.
- CSV được xử lý trong trình duyệt, không gửi lên backend và không lưu vào history/localStorage. Nội dung mất khi tải lại trang. Đây là trình xem; file gốc không bị sửa.

Sau khi cập nhật tính năng CSV, khởi động lại Node một lần để nạp các đường dẫn module mới, rồi tải lại trình duyệt.

## Dữ liệu và thực thi

Server chỉ lắng nghe `127.0.0.1`; giao diện phải mở bằng `localhost` hoặc `127.0.0.1` với đúng port. Các API ghi dữ liệu có token phiên và kiểm tra origin/host. Backend chỉ cung cấp các thao tác cố định; input được kiểm tra và CLI nhận tham số riêng qua `spawn`, không có API thực thi shell tùy ý. Firebase CLI trên Windows được chạy qua Node entry point để giữ nguyên đường dẫn có dấu cách.

Cấu hình, tối đa 100 tác vụ gần nhất và file tạm nằm trong `.local/` (đã gitignore). Lựa chọn ứng dụng, package name, thiết bị gần nhất và theme được lưu trong localStorage của trình duyệt. Mỗi lần chỉ chạy một tác vụ. Không đưa server này lên hosting công khai; trình duyệt cần backend local để gọi công cụ trên máy.

### Khi đưa mã nguồn lên GitHub

- Cài đặt môi trường nằm ở `.local/settings.json`; lịch sử hoạt động và log nằm ở `.local/history.json`. Các file ZIP tạm nằm trong `.local/uploads/` và được xóa sau khi CLI kết thúc. Có thể đổi thư mục dữ liệu bằng biến môi trường `DEVKIT_DATA_DIR`.
- `.local/` đã có trong `.gitignore`, nên Git không thêm dữ liệu này khi commit thông thường. File đã được theo dõi từ trước vẫn cần được gỡ khỏi Git nếu có.
- Lựa chọn ứng dụng/package, thiết bị và giao diện sáng/tối nằm trong localStorage của trình duyệt với tiền tố `devkit.`; dữ liệu tách theo trình duyệt, profile và địa chỉ web (bao gồm cổng).
- Người clone và chạy dự án trên máy khác sẽ có dữ liệu local riêng. GitHub Pages chỉ phục vụ file tĩnh, không chạy Node.js, ADB, Firebase CLI hoặc Android Monitor. Các chức năng hiện tại cần backend Node local; đưa frontend lên Pages riêng chưa đủ để sử dụng chúng.

## Ứng dụng Windows EXE

Bản đóng gói nằm trong `dist/Devkit-1.0.2-win-x64.exe`. Chỉ cần gửi một file EXE này; người dùng không cần clone repository, cài Node.js hay chạy `npm start`. Hỗ trợ Windows 10/11 x64 với .NET Framework 4.8.

Nhấp đúp EXE để mở cửa sổ Devkit. Lần đầu ứng dụng giải nén runtime vào `%LOCALAPPDATA%\Devkit\runtime`, chạy backend bằng Node đi kèm và mở giao diện local trong trình duyệt mặc định. Nút **Mở Devkit** mở lại trang; nút **X** hoặc thu nhỏ sẽ ẩn xuống khay hệ thống và giữ backend chạy. Chọn **Dừng và thoát** trong cửa sổ hoặc menu khay hệ thống để dừng backend và các tiến trình con do nó chạy. Khi có tác vụ đang chạy, ứng dụng hỏi trước khi dừng.

Nếu tab báo mất kết nối khi gửi symbols, mở lại EXE rồi bấm **Mở Devkit** để đến đúng địa chỉ. Khi backend chạy lại ở cùng địa chỉ, trang tự kết nối lại; nút **Kết nối lại** cũng kiểm tra kết nối mà không cần tải lại trang. Giữ ứng dụng chạy trong khi upload.

Cổng mặc định là 3210; nếu bận, ứng dụng chọn một cổng trống trong 3211–3259. Một bản EXE thứ hai sẽ mở lại giao diện của bản đang chạy, không khởi động backend thứ hai.

- Cài đặt/lịch sử của bản EXE nằm trong `%LOCALAPPDATA%\Devkit\data`; log khởi động tại `%LOCALAPPDATA%\Devkit\launcher.log`. Có thể ghi đè thư mục bằng `DEVKIT_DATA_DIR` và `DEVKIT_DESKTOP_HOME`.
- Gói chỉ chứa mã ứng dụng, tài nguyên giao diện, Node runtime và giấy phép Node; không chứa `.local/`, tài khoản Firebase, symbols hoặc dữ liệu cá nhân trên máy build. Dữ liệu nguồn cũ không tự được sao chép. Khi ứng dụng đã dừng, có thể chép `settings.json` và `history.json` sang thư mục data để dùng tiếp; đường dẫn công cụ cần phù hợp với máy đích.
- ADB, Firebase CLI/tài khoản đăng nhập, SDK Tools cũ và Java vẫn cần được chuẩn bị riêng. Firebase có thể dùng bản standalone `firebase.exe` hoặc bản `firebase.js`/`firebase.cmd` có sẵn; bản JS dùng Node đi kèm. EXE chưa có chữ ký số.
- EXE mở giao diện **local** để dùng đầy đủ tính năng. Kết nối điều khiển từ GitHub Pages tới máy tính chưa được bổ sung.

Build lại trên Windows x64 với Node.js 22+ và .NET Framework 4.8:

```powershell
npm run package:windows
```

Script dùng trình biên dịch C# và ZIP có sẵn trong Windows; không cần npm dependency hoặc tải binary đóng gói. Kết quả gồm EXE, checksum SHA-256 và `README-Windows.txt`. Thư mục `dist/` và `.build/` được bỏ qua bởi Git. Mỗi bản dùng Node runtime của máy build, vì vậy nên build bằng Node 22 LTS đã cập nhật.

Workflow **Build Windows EXE** chạy thủ công trong tab Actions hoặc khi push tag `v*`. Workflow chạy test, build, kiểm tra EXE khi PATH không có Node và xuất artifact **Devkit-Windows-x64** để tải xuống. Không tự xuất bản GitHub Release.

## Deploy GitHub Pages

Workflow [Deploy GitHub Pages](.github/workflows/deploy-pages.yml) tự chạy khi push lên nhánh `main`; cũng có thể chạy thủ công từ tab **Actions → Deploy GitHub Pages → Run workflow**.

1. Trên GitHub, vào **Settings → Pages → Build and deployment → Source**, chọn **GitHub Actions**.
2. Commit và push mã nguồn, gồm thư mục `.github/workflows`, lên nhánh `main`.
3. Mở tab **Actions** để xem kết quả. Sau khi deploy thành công, URL website xuất hiện trong job **Deploy** và trang **Settings → Pages**.

Workflow chạy `npm test` bằng Node.js 22 trên runner, sau đó đăng riêng thư mục `public/`. Frontend dùng HTML/CSS/JavaScript thuần nên không cần `npm install` hoặc `npm run build`. Đường dẫn tài nguyên tương đối hỗ trợ cả Pages tại domain gốc và đường dẫn repository. Backend, lịch sử và cài đặt trong `.local/` không nằm trong artifact website.

**Giới hạn:** GitHub Pages chạy được JSON Formatter và CSV Viewer ngay trong trình duyệt, không cần Node trên máy người xem. Các tính năng ADB, upload symbols và Android Monitor vẫn cần mở bản local tại `http://localhost:3210`. Bản Pages tự nhận diện chế độ web: không gọi/poll API local, không báo lỗi kết nối khi mở trang và vô hiệu hóa thao tác cần backend với hướng dẫn mở bản local. Lịch sử và cài đặt môi trường được xem/lưu trong bản local. Chạy `npm start` không tự kết nối trang Pages với backend local; hãy mở địa chỉ localhost. Chế độ local được dùng khi mở bằng HTTP tại `localhost` hoặc `127.0.0.1`.

## Kiểm tra

```powershell
npm test
```

Kiểm tra lệnh bật/tắt debug, kiểm tra tham số và shell injection, parse thiết bị ADB, tiến trình/exit code/timeout, đường dẫn symbols có dấu cách, chữ ký ZIP, các API cấu hình và bảo vệ host/origin/token. API test sử dụng thư mục tạm riêng, không sửa cấu hình workspace hoặc thực hiện upload Firebase.
