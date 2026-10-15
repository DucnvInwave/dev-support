DEVKIT DÀNH CHO MACOS — __APP_VERSION__ (__ARCH__)
=================================================

Yêu cầu macOS 13 trở lên.
- arm64: Mac dùng chip Apple Silicon (M1, M2, M3, M4, ...).
- x64: Mac dùng chip Intel.
Kiểm tra tại menu Apple > About This Mac.

1. Giải nén ZIP, kéo Devkit.app vào Applications.
2. Mở Devkit.app. Ứng dụng tự chạy backend và mở trang localhost.
3. Đóng cửa sổ không dừng backend. Dùng menu devkit. trên thanh menu
   để mở lại trang, mở cửa sổ hoặc chọn Dừng và thoát.
4. Khi đổi phiên bản, Dừng và thoát bản cũ trước khi thay ứng dụng.

Không cần cài Node.js riêng. Node.js đi kèm trong Devkit.app.
Gói được ký ad-hoc để kiểm tra toàn vẹn, chưa có Developer ID/notarization.
Nếu macOS chặn, chỉ mở gói từ nguồn bạn tin tưởng bằng Privacy & Security >
Open Anyway. Không cần tắt Gatekeeper.

CÔNG CỤ TRÊN MÁY
- JSON Formatter / CSV Viewer: dùng ngay, xử lý trong trình duyệt.
- Firebase DebugView: cần Android SDK Platform Tools (adb), USB debugging
  và cấp quyền trên thiết bị Android. SDK mặc định: ~/Library/Android/sdk.
- Crashlytics Symbols: cần Firebase CLI dành cho macOS và tài khoản có quyền
  đã đăng nhập. Có thể chọn đường dẫn firebase hoặc firebase.js trong Cài đặt.
  Bản JS đã cài dùng Node đi kèm, không bắt buộc Node trong PATH khi mở app.
  Cài CLI bằng npm cần Node/npm hoặc dùng bản standalone macOS chính thức.
- Android Monitor: cần SDK Tools cũ có tools/monitor, Java/SWT tương thích
  với macOS và kiến trúc máy. SDK mới đã loại bỏ công cụ này. Bản cũ có thể
  không hoạt động trên Apple Silicon. Devkit không kèm SDK hoặc Java.
  Thành công chỉ xác nhận gửi yêu cầu khởi động, không xác nhận GUI đã mở.
  macOS không sử dụng tùy chọn quyền Administrator của Windows.

DỮ LIỆU
~/Library/Application Support/Devkit/data/settings.json
~/Library/Application Support/Devkit/data/history.json
~/Library/Application Support/Devkit/launcher.log
Có thể đổi bằng DEVKIT_DESKTOP_HOME và DEVKIT_DATA_DIR.
Dữ liệu Windows hoặc .local không tự sao chép. Khi chuyển máy cần sửa
đường dẫn ADB/Firebase/SDK cho đúng hệ điều hành; đăng nhập Firebase trên Mac.

Cổng mặc định 3210, tự chọn 3211–3259 nếu đang bận.
Nút Mở Devkit mở đúng địa chỉ. Gói này không kết nối trang GitHub Pages
với backend local. File .exe chỉ dành cho Windows.
