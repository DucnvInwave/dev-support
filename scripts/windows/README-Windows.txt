DEVKIT DÀNH CHO WINDOWS
=======================

1. Mở Devkit-__APP_VERSION__-win-x64.exe bằng cách nhấp đúp.
2. Chờ giải nén trong lần đầu. Devkit sẽ mở giao diện trong trình duyệt mặc định.
3. Nút X hoặc thu nhỏ sẽ ẩn xuống khay hệ thống; ứng dụng vẫn chạy.
4. Nhấn "Mở Devkit" để mở lại trang. Chọn "Dừng và thoát" trong cửa sổ
   hoặc menu khay hệ thống để dừng ứng dụng.
5. Nếu trang báo mất kết nối, mở lại EXE rồi nhấn "Mở Devkit".
   Giữ ứng dụng chạy cho đến khi upload symbols hoàn tất.

Không cần cài Node.js riêng, không cần chạy npm start.
Hỗ trợ Windows 10/11 x64 với .NET Framework 4.8.
EXE chứa Node.js, backend và toàn bộ giao diện.
Bản hiện tại chưa có chữ ký số.

CÔNG CỤ ANDROID / FIREBASE
- ADB: cần Android SDK Platform Tools, bật USB debugging trên điện thoại.
- Crashlytics: cần Firebase CLI và tài khoản đã đăng nhập, có quyền upload.
  Có thể chọn firebase.exe bản standalone hoặc một bản firebase.js đã cài.
  Bản firebase.cmd đã có sẵn trên máy sẽ dùng Node đi kèm trong gói.
- Android Monitor: cần SDK Tools cũ có tools/monitor.bat và Java tương thích.
Các công cụ bên ngoài này không nằm trong EXE.

DỮ LIỆU
Cài đặt/lịch sử:  %LOCALAPPDATA%\Devkit\data
Bộ đệm runtime:   %LOCALAPPDATA%\Devkit\runtime
Log khởi động:    %LOCALAPPDATA%\Devkit\launcher.log

Dữ liệu .local của bản mã nguồn không được đưa vào EXE hoặc tự sao chép.
Có thể chép settings.json và history.json từ .local vào thư mục data khi ứng dụng
đã dừng; kiểm tra lại đường dẫn công cụ nếu chuyển sang máy khác.
DEVKIT_DATA_DIR có thể thay đổi thư mục dữ liệu.
DEVKIT_DESKTOP_HOME có thể thay đổi thư mục ứng dụng.

ĐỊA CHỈ WEB
Ứng dụng thường mở http://localhost:3210.
Nếu cổng đang bận, Devkit chọn cổng trống trong 3211-3259.
Nút "Mở Devkit" luôn mở đúng địa chỉ.
Giao diện local dùng đầy đủ tính năng.
Gói này chưa bổ sung kết nối từ GitHub Pages đến backend local.
