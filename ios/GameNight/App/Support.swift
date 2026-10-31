import CoreImage.CIFilterBuiltins
import SafariServices
import SwiftUI

/// A server page inside the app, for the screens it leaves to the web —
/// rules (one source of truth, on the server), ito's stats, a scorekeeper's
/// board.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredBarTintColor = UIColor(Theme.feltDark)
        controller.preferredControlTintColor = UIColor(Theme.goldBright)
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// A URL that can drive `.sheet(item:)`.
struct WebPage: Identifiable, Equatable {
    let url: URL
    var id: String { url.absoluteString }
}

extension View {
    /// Tables and topic displays sit on the table for an hour at a time;
    /// the screen locking mid-round is the thing that would break them.
    func keepsScreenAwake() -> some View {
        modifier(KeepsScreenAwake())
    }
}

/// Counted, not a plain switch: screens that want the screen awake can
/// overlap (a web sheet over a table, one table replacing another), and
/// the first to go used to let the phone lock under the one still showing.
private struct KeepsScreenAwake: ViewModifier {
    private static var holders = 0 {
        didSet { UIApplication.shared.isIdleTimerDisabled = holders > 0 }
    }
    @State private var holding = false

    func body(content: Content) -> some View {
        content
            .onAppear {
                guard !holding else { return }
                holding = true
                Self.holders += 1
            }
            .onDisappear {
                guard holding else { return }
                holding = false
                Self.holders -= 1
            }
    }
}

/// A room's link through the share sheet, beside every invite QR: the QR
/// only reaches someone at the table, a link can go over Messages to someone
/// on their way. It's the same web link the QR holds, so it opens the app
/// where it's installed (Associated Domains) and the web table where it isn't.
/// Styled by the screen it's on.
struct InviteLink: View {
    let url: URL
    let message: String

    var body: some View {
        ShareLink(item: url, subject: Text("Game Night"), message: Text(message)) {
            Label("Send invite", systemImage: "square.and.arrow.up")
        }
    }
}

/// A QR code as an image, for codes the app shows: a room's invite, a link
/// for signing another device in. Scale with `.interpolation(.none)`.
enum QRCode {
    static func image(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

extension View {
    /// "Reconnecting…" at the top of a table while its polls aren't getting
    /// through, so a poor signal doesn't pass for a game that's stuck.
    func reconnecting(_ connection: PollHealth) -> some View {
        overlay(alignment: .top) {
            if connection.struggling {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(.white)
                    Text("Reconnecting…").font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.black.opacity(0.78), in: Capsule())
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .accessibilityElement(children: .combine)
                .allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: connection.struggling)
    }
}
