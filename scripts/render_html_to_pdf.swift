import Foundation
import WebKit
import AppKit

final class Runner: NSObject, WKNavigationDelegate {
    let inputURL: URL
    let outputURL: URL
    let app: NSApplication
    let webView: WKWebView
    let window: NSWindow

    init(inputURL: URL, outputURL: URL, app: NSApplication) {
        self.inputURL = inputURL
        self.outputURL = outputURL
        self.app = app
        let config = WKWebViewConfiguration()
        self.webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 816, height: 1056), configuration: config)
        self.window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 816, height: 1056), styleMask: [.titled], backing: .buffered, defer: false)
        super.init()
        self.window.contentView = self.webView
        self.window.orderOut(nil)
        self.webView.navigationDelegate = self
    }

    func start() throws {
        let html = try String(contentsOf: inputURL, encoding: .utf8)
        webView.loadHTMLString(html, baseURL: inputURL.deletingLastPathComponent())
    }

    func fail(_ error: Error) -> Never {
        fputs("\(error)\n", stderr)
        exit(1)
    }

    func renderPaginatedPDF() {
        let printInfo = NSPrintInfo.shared.copy() as! NSPrintInfo
        printInfo.jobDisposition = NSPrintInfo.JobDisposition.save
        printInfo.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = outputURL
        printInfo.paperSize = NSSize(width: 612, height: 792)
        printInfo.topMargin = 46
        printInfo.bottomMargin = 46
        printInfo.leftMargin = 46
        printInfo.rightMargin = 46
        printInfo.horizontalPagination = .fit
        printInfo.verticalPagination = .automatic
        printInfo.isHorizontallyCentered = true
        printInfo.isVerticallyCentered = false

        let op = webView.printOperation(with: printInfo)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        if op.run() {
            app.terminate(nil)
        } else {
            fail(NSError(domain: "RenderHTMLToPDF", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to render paginated PDF"]))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            self.renderPaginatedPDF()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let app = NSApplication.shared
let runner = Runner(inputURL: input, outputURL: output, app: app)
DispatchQueue.main.async {
    do {
        try runner.start()
    } catch {
        runner.fail(error)
    }
}
app.run()
