import Cocoa
import Darwin

private func failure(_ text: String) -> NSError { NSError(domain: "Devkit", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
private final class Reply { var data: Data?; var response: HTTPURLResponse? }

final class Runtime {
    let home: URL
    let data: URL
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    var url = ""
    var worker: Process?
    var ownsLock = false
    private var lockFD: Int32 = -1
    private var log: FileHandle?

    init() throws {
        let env = ProcessInfo.processInfo.environment
        home = URL(fileURLWithPath: env["DEVKIT_DESKTOP_HOME"] ?? NSHomeDirectory() + "/Library/Application Support/Devkit", isDirectory: true).standardizedFileURL
        data = URL(fileURLWithPath: env["DEVKIT_DATA_DIR"] ?? home.appendingPathComponent("data").path, isDirectory: true).standardizedFileURL
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        lockFD = Darwin.open(home.appendingPathComponent("desktop.lock").path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
        guard lockFD >= 0 else { throw failure("Không mở được thư mục dữ liệu Devkit.") }
        ownsLock = flock(lockFD, LOCK_EX | LOCK_NB) == 0
    }
    deinit {
        stop()
        if lockFD >= 0 { if ownsLock { flock(lockFD, LOCK_UN) }; Darwin.close(lockFD) }
    }
    func get(_ address: String, instance: String? = nil) throws -> Data {
        guard let endpoint = URL(string: address.replacingOccurrences(of: "http://localhost:", with: "http://127.0.0.1:")) else { throw failure("Địa chỉ không hợp lệ.") }
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]
        config.timeoutIntervalForRequest = 1.5
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let reply = Reply(), done = DispatchSemaphore(value: 0)
        let task = session.dataTask(with: endpoint) { bytes, response, _ in
            reply.data = bytes; reply.response = response as? HTTPURLResponse; done.signal()
        }
        task.resume()
        guard done.wait(timeout: .now() + 2) == .success, let bytes = reply.data, let response = reply.response, response.statusCode == 200 else { throw failure("Chưa kết nối được backend Devkit.") }
        if let expected = instance, response.value(forHTTPHeaderField: "X-Devkit-Instance") != expected { throw failure("Cổng đang được ứng dụng khác sử dụng.") }
        return bytes
    }
    private func freePort() throws -> Int {
        for port in 3210..<3260 {
            let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 { continue }
            defer { Darwin.close(fd) }
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = UInt16(port).bigEndian
            address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
            let result = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            if result == 0 { return port }
        }
        throw failure("Các cổng 3210–3259 đang bận. Hãy dừng một bản Devkit rồi thử lại.")
    }
    func start() throws {
        guard ownsLock else { throw failure("Devkit đã được mở.") }
        guard let resources = Bundle.main.resourceURL else { throw failure("Gói Devkit không đầy đủ.") }
        let port = try freePort()
        url = "http://localhost:\(port)"
        let app = resources.appendingPathComponent("app")
        let runtime = resources.appendingPathComponent("runtime")
        let logfile = home.appendingPathComponent("launcher.log")
        FileManager.default.createFile(atPath: logfile.path, contents: nil)
        log = try FileHandle(forWritingTo: logfile)
        let process = Process()
        process.executableURL = runtime.appendingPathComponent("node")
        process.arguments = [app.appendingPathComponent("desktop.mjs").path]
        process.currentDirectoryURL = app
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port); env["DEVKIT_DATA_DIR"] = data.path
        env["DEVKIT_DESKTOP_INSTANCE"] = nonce
        env["DEVKIT_DESKTOP_PARENT_PID"] = String(getpid())
        env["PATH"] = [runtime.path, "/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.npm-global/bin", NSHomeDirectory() + "/Library/Android/sdk/platform-tools", env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"].joined(separator: ":")
        process.environment = env
        process.standardInput = FileHandle.nullDevice; process.standardOutput = log; process.standardError = log
        try process.run(); worker = process
        let deadline = Date().addingTimeInterval(25)
        while Date() < deadline {
            guard process.isRunning else { throw failure("Không khởi động được Devkit. Xem \(logfile.path)") }
            if (try? get(url + "/api/health", instance: nonce)) != nil {
                try (url + "\n" + nonce).write(to: home.appendingPathComponent("desktop-port.txt"), atomically: true, encoding: .utf8)
                return
            }
            Thread.sleep(forTimeInterval: 0.12)
        }
        throw failure("Khởi động quá lâu. Xem \(logfile.path)")
    }
    func openExisting() -> Bool {
        guard let text = try? String(contentsOf: home.appendingPathComponent("desktop-port.txt"), encoding: .utf8) else { return false }
        let parts = text.components(separatedBy: "\n")
        guard parts.count >= 2, let address = URL(string: parts[0]), address.scheme == "http", address.host == "localhost", address.path.isEmpty, address.user == nil, address.password == nil, address.query == nil, address.fragment == nil, let port = address.port, (3210..<3260).contains(port), parts[1].range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else { return false }
        guard (try? get(parts[0] + "/api/health", instance: parts[1])) != nil else { return false }
        return NSWorkspace.shared.open(address)
    }
    func runningJob() -> Bool {
        guard let bytes = try? get(url + "/api/jobs", instance: nonce), let jobs = try? JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] else { return false }
        return jobs.contains { $0["status"] as? String == "running" }
    }
    func openBrowser() { if let address = URL(string: url) { NSWorkspace.shared.open(address) } }
    func stop() {
        if let process = worker, process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(5)
            while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
            if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
        }
        worker = nil; try? log?.close(); log = nil
    }
    func smokeTest() throws {
        try start()
        let bytes = try get(url + "/api/session", instance: nonce)
        guard let session = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let token = session["token"] as? String, token.count == 64 else { throw failure("Session test failed.") }
        for asset in ["/", "/styles.css", "/app.js", "/json-tools.js", "/json-ui.js", "/csv-tools.js", "/csv-ui.js", "/favicon.svg"] {
            if try get(url + asset, instance: nonce).isEmpty { throw failure("Missing asset \(asset)") }
        }
        let report = "PASS: Devkit __APP_VERSION__, bundled Node, local API and all frontend assets\n" + String(decoding: try get(url + "/api/health", instance: nonce), as: UTF8.self)
        try report.write(to: home.appendingPathComponent("smoke-test.txt"), atomically: true, encoding: .utf8)
        print(report)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let runtime: Runtime
    var window: NSWindow!
    var status: NSTextField!
    var openButton: NSButton!
    var item: NSStatusItem!
    var timer: Timer?
    var starting = true
    var ready = false
    init(_ runtime: Runtime) { self.runtime = runtime }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        for (title, selector) in [("Mở Devkit", #selector(openBrowser)), ("Hiện cửa sổ", #selector(showWindow)), ("Mở thư mục dữ liệu", #selector(openData)), ("Dừng và thoát", #selector(quit))] {
            let entry = NSMenuItem(title: title, action: selector, keyEquivalent: selector == #selector(quit) ? "q" : "")
            entry.target = self; menu.addItem(entry)
        }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "devkit."; item.menu = menu
        let appMenu = NSMenu(); let appEntry = NSMenuItem(); let appSubmenu = NSMenu(title: "Devkit")
        let quitItem = NSMenuItem(title: "Dừng và thoát", action: #selector(quit), keyEquivalent: "q"); quitItem.target = self
        appSubmenu.addItem(quitItem); appEntry.submenu = appSubmenu; appMenu.addItem(appEntry); NSApp.mainMenu = appMenu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 320), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Devkit __APP_VERSION__"; window.isReleasedWhenClosed = false; window.delegate = self
        let view = window.contentView!
        func label(_ text: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ size: CGFloat) -> NSTextField {
            let field = NSTextField(wrappingLabelWithString: text); field.font = .systemFont(ofSize: size)
            field.frame = NSRect(x: x, y: y, width: width, height: height); view.addSubview(field); return field
        }
        _ = label("devkit.", 30, 242, 500, 48, 32)
        _ = label("Firebase · Android · JSON · CSV", 32, 210, 500, 30, 17)
        status = label("Đang chuẩn bị ứng dụng…", 32, 145, 510, 52, 16)
        openButton = NSButton(title: "Mở Devkit", target: self, action: #selector(openBrowser)); openButton.frame = NSRect(x: 28, y: 87, width: 170, height: 42); openButton.bezelStyle = .rounded; openButton.isEnabled = false; view.addSubview(openButton)
        let exit = NSButton(title: "Dừng và thoát", target: self, action: #selector(quit)); exit.frame = NSRect(x: 210, y: 87, width: 170, height: 42); exit.bezelStyle = .rounded; view.addSubview(exit)
        _ = label("Đóng cửa sổ vẫn giữ Devkit chạy. Dùng menu devkit. để mở lại hoặc thoát.", 32, 26, 510, 45, 13)
        window.center(); showWindow()
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.runtime.start()
                DispatchQueue.main.async {
                    self.starting = false; self.ready = true; self.openButton.isEnabled = true
                    self.status.stringValue = "Ứng dụng đã sẵn sàng.\n" + self.runtime.url
                    self.openBrowser()
                    self.timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
                        if self.runtime.worker?.isRunning != true {
                            self.ready = false; self.openButton.isEnabled = false
                            self.status.stringValue = "Devkit đã dừng. Chọn Dừng và thoát rồi mở lại ứng dụng."
                            self.timer?.invalidate()
                        }
                    }
                }
            } catch {
                self.runtime.stop()
                DispatchQueue.main.async {
                    self.starting = false; self.status.stringValue = error.localizedDescription
                    let alert = NSAlert(); alert.messageText = "Chưa mở được Devkit"; alert.informativeText = error.localizedDescription; alert.runModal()
                }
            }
        }
    }
    @objc func openBrowser() { if ready { runtime.openBrowser() } }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func openData() { NSWorkspace.shared.open(runtime.data) }
    @objc func quit() { NSApp.terminate(nil) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); openBrowser(); return true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if starting {
            let alert = NSAlert(); alert.messageText = "Đang khởi động Devkit"; alert.informativeText = "Bạn có thể thoát sau khi quá trình này hoàn tất."; alert.runModal(); return .terminateCancel
        }
        if ready && runtime.runningJob() {
            let alert = NSAlert(); alert.messageText = "Một tác vụ đang chạy"; alert.informativeText = "Dừng ứng dụng sẽ hủy tác vụ đó. Bạn có muốn thoát?"; alert.addButton(withTitle: "Tiếp tục sử dụng"); alert.addButton(withTitle: "Dừng và thoát")
            if alert.runModal() != .alertSecondButtonReturn { return .terminateCancel }
        }
        return .terminateNow
    }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); runtime.stop() }
}

do {
    let runtime = try Runtime()
    let smoke = CommandLine.arguments.contains("--smoke-test")
    if !runtime.ownsLock {
        if smoke { throw failure("Another Devkit instance owns this data directory.") }
        if !runtime.openExisting() { let alert = NSAlert(); alert.messageText = "Devkit đang khởi động. Bạn chờ một chút rồi mở lại nhé."; alert.runModal() }
    } else if smoke {
        try runtime.smokeTest(); runtime.stop()
    } else {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = AppDelegate(runtime); app.delegate = delegate; withExtendedLifetime(delegate) { app.run() }
    }
} catch {
    if CommandLine.arguments.contains("--smoke-test") { FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)) }
    else { let alert = NSAlert(); alert.messageText = "Không mở được Devkit"; alert.informativeText = error.localizedDescription; alert.runModal() }
    Darwin.exit(1)
}
