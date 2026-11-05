import AppKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: Process?
    private var address: URL?
    private var stopping = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "打开图纸制作", action: #selector(openPage), keyEquivalent: "o")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 AI拼豆图纸", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = menu
        NSApp.setActivationPolicy(.regular)

        guard let resources = Bundle.main.resourceURL else { fail("找不到应用资源。请重新下载运行包。", terminate: true); return }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = resources.appendingPathComponent("node")
        process.arguments = [resources.appendingPathComponent("app/server/server.js").path]
        process.currentDirectoryURL = resources.appendingPathComponent("app")
        var environment: [String: String] = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "BEAD_STATIC_DIR": resources.appendingPathComponent("app/dist").path]
        for key in ["HOME", "TMPDIR", "USER", "LOGNAME"] { if let value = ProcessInfo.processInfo.environment[key] { environment[key] = value } }
        process.environment = environment
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                self.fail("本地服务意外退出，请重新启动应用。", terminate: true)
            }
        }
        server = process
        do { try process.run() } catch { fail("无法启动本地服务，请重新下载运行包。", terminate: true); return }
        DispatchQueue.global().async { [weak self] in
            var bytes = Data()
            while bytes.count < 8 {
                let part = pipe.fileHandleForReading.readData(ofLength: 1)
                if part.isEmpty || part == Data([10]) { break }
                bytes.append(part)
            }
            let line = String(data: bytes, encoding: .utf8) ?? ""
            let port = Int(line)
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                guard let port = port, (1...65535).contains(port), line == String(port) else {
                    self.fail("本地服务启动失败，请重新启动应用。", terminate: true); return
                }
                self.address = URL(string: "http://127.0.0.1:\(port)/")!
                self.openPage()
            }
            _ = pipe.fileHandleForReading.readDataToEndOfFile()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, self.address == nil, !self.stopping else { return }
            self.fail("本地服务启动超时，请重新启动应用。", terminate: true)
        }
    }
    @objc func openPage() { if let address = address { NSWorkspace.shared.open(address) } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openPage(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        if let server = server, server.isRunning {
            server.terminate()
            let pid = server.processIdentifier
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) { if server.isRunning { kill(pid, SIGKILL) } }
            server.waitUntilExit()
        }
    }
    private func fail(_ message: String, terminate: Bool) {
        stopping = true
        let alert = NSAlert(); alert.messageText = "AI拼豆图纸无法运行"; alert.informativeText = message; alert.runModal()
        if terminate { NSApp.terminate(nil) }
    }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
