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
        onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
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
