import SwiftUI
import WebKit

/// What a web tile opens: the game, and its page on the server.
struct WebGameLaunch: Identifiable {
    let game: GameListing
    let url: URL
    var id: String { game.id }
}

/// A web-only game (Final Approach, and whatever the server lists later)
/// played full screen, signed in as this device's profile (app 1.14.0).
///
/// A WKWebView rather than the Safari sheet: no browser chrome, its own
/// persistent storage (the game's progress and settings survive), sound
/// without an extra tap, and a script that writes the app's profile into the
/// page's `gamenight:me` before the page's own scripts run (`WebSignIn`).
/// No status bar or home indicator, edge swipes deferred (a route drawn off
/// the bottom edge mustn't go home), the screen kept awake, any orientation.
///
/// The way out is a grabber at the top centre, the one stretch of edge the
/// games' HUDs leave alone (their corners carry plates, pause and strips):
/// pull it down, or tap it and then "Close game".
struct WebGameScreen: View {
    let launch: WebGameLaunch
    @Environment(\.dismiss) private var dismiss
    @State private var page = WebGamePage()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            GameWebView(url: launch.url,
                        script: WebSignIn.script(for: Me.current, origin: WebSignIn.origin(of: launch.url) ?? ""),
                        page: page)
                .ignoresSafeArea()
            if let failure = page.failure {
                failed(failure)
            } else if !page.loaded {
                ProgressView().controlSize(.large).tint(.white)
            }
        }
        .overlay(alignment: .top) {
            CloseHandle { dismiss() }
        }
        // A link back to the web hub (the game's own "Game Night" button)
        // closes the game: the app's hub is home here.
        .onChange(of: page.closeRequested) { _, closing in
            if closing { dismiss() }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .defersSystemGestures(on: .all)
        .keepsScreenAwake()
        .preferredColorScheme(.dark)
    }

    private func failed(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40))
            Text(launch.game.name).font(Theme.display(26))
            Text(message).font(.subheadline).multilineTextAlignment(.center).foregroundStyle(Theme.cream.opacity(0.75))
            HStack(spacing: 10) {
                Button { page.retry(launch.url) } label: { Label("Try again", systemImage: "arrow.clockwise") }
                    .buttonStyle(FeltButtonStyle())
                Button { dismiss() } label: { Label("Close", systemImage: "xmark") }
                    .buttonStyle(FeltButtonStyle(kind: .ghost))
            }
        }
        .foregroundStyle(Theme.cream)
        .padding(28)
        .frame(maxWidth: 420)
    }
}

/// How the page is getting on, for the spinner and the "couldn't reach" card.
@Observable
final class WebGamePage {
    /// The first page has started to show.
    var loaded = false
    /// Why the first page didn't load, while that's the case.
    var failure: String?
    /// The page asked to go to the web hub: close the game instead.
    var closeRequested = false
    @ObservationIgnored weak var webView: WKWebView?

    func retry(_ url: URL) {
        failure = nil
        webView?.load(URLRequest(url: url))
    }
}

private struct GameWebView: UIViewRepresentable {
    let url: URL
    let script: String
    let page: WebGamePage

    func makeCoordinator() -> Coordinator {
        Coordinator(home: url, page: page)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // The app's own persistent store: the game's localStorage (progress,
        // settings, its outbox of shifts) is still there next time.
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // Before any of the page's scripts, top frame only; the script itself
        // checks it's on the Game Night server before touching anything.
        configuration.userContentController.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        // The pages use viewport-fit=cover and env(safe-area-inset-*): with
        // no automatic inset, the safe area reaches the page's CSS instead.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        page.webView = webView
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let home: URL
        let page: WebGamePage

        init(home: URL, page: WebGamePage) {
            self.home = home
            self.page = page
        }

        /// Pages on the Game Night server stay here (records, another game,
        /// the hub); anything else goes to the system browser.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .cancel }
            // Frames inside a page load what they like; only the page moves.
            if let frame = navigationAction.targetFrame, !frame.isMainFrame { return .allow }
            switch WebGameLinks.decision(for: url, home: home) {
            case .stay:
                return .allow
            case .openOutside:
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                return .cancel
            case .closeToHub:
                page.closeRequested = true
                return .cancel
            }
        }

        /// A link that asks for a new window (target=_blank, window.open):
        /// there's one window here, so the same rule in this one.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                switch WebGameLinks.decision(for: url, home: home) {
                case .stay: webView.load(navigationAction.request)
                case .openOutside: UIApplication.shared.open(url, options: [:], completionHandler: nil)
                case .closeToHub: page.closeRequested = true
                }
            }
            return nil
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            page.loaded = true
            page.failure = nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            failed(error)
        }

        /// iOS can end a page's process to free memory; bring the game back
        /// rather than leave a blank screen.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        /// Only the first page's failure is shown: after that the game is on
        /// screen, and a link that fails leaves it there.
        private func failed(_ error: any Error) {
            let error = error as NSError
            guard !page.loaded, error.domain == NSURLErrorDomain, error.code != NSURLErrorCancelled else { return }
            page.failure = "Couldn’t reach the Game Night server. Check the connection and try again."
        }
    }
}

/// The way out: a small grabber at the top centre. Pull it down to close, or
/// tap it for a "Close game" button (gone again after a few seconds), so a
/// stray touch mid-game doesn't end the game.
private struct CloseHandle: View {
    let close: () -> Void
    @State private var armed = false
    @State private var pull: CGFloat = 0

    var body: some View {
        VStack(spacing: 8) {
            Capsule()
                .fill(.white.opacity(armed ? 0.85 : 0.4))
                .overlay(Capsule().strokeBorder(.black.opacity(0.4), lineWidth: 0.5))
                .frame(width: 40, height: 5)
                .padding(.top, 5)
                .frame(width: 96, height: 28, alignment: .top)
                .contentShape(Rectangle())
                .onTapGesture {
                    if armed { close() } else { withAnimation(.easeOut(duration: 0.2)) { armed = true } }
                }
                .gesture(
                    DragGesture(minimumDistance: 6)
                        .onChanged { pull = max(0, $0.translation.height) }
                        .onEnded { value in
                            if value.translation.height > 60 {
                                close()
                            } else {
                                withAnimation(.spring(duration: 0.25)) { pull = 0 }
                            }
                        }
                )
                .accessibilityElement()
                .accessibilityLabel("Close game")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { close() }

            if armed {
                Button(action: close) {
                    Label("Close game", systemImage: "xmark")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.black.opacity(0.72), in: Capsule())
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .offset(y: min(pull, 80))
        .opacity(1 - Double(min(pull, 80)) / 160)
        .task(id: armed) {
            guard armed else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.2)) { armed = false }
        }
    }
}
