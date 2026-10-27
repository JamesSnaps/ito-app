import SwiftUI
import VisionKit

/// Scanning a Game Night QR inside the app — a room's invite, or the code
/// "You" shows for signing another device in — rather than leaving for the
/// Camera app. Whatever it reads goes through `Joining.destination(for:)`,
/// the same as a link opened from outside.
struct ScanSheet: View {
    let onScanned: (URL) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if Self.canScan {
                    QRScanner { text in
                        if let url = URL(string: text), Joining.isOurs(url) {
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            onScanned(url)
                            dismiss()
                        } else {
                            problem = "That QR code isn’t a Game Night one."
                        }
                    }
                    .ignoresSafeArea()
                    VStack {
                        Spacer()
                        Text(problem ?? "Point the camera at the QR code on the table’s screen.")
                            .font(.subheadline.weight(.semibold))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding(.bottom, 40)
                    }
                } else {
                    Text("This device can’t scan codes — check the camera is allowed for Game Night in Settings, or type the room code instead.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                        .padding(30)
                }
            }
            .navigationTitle("Scan a code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }

    static var canScan: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }
}

/// VisionKit's live scanner, QR codes only; reports the first one it reads.
struct QRScanner: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        // Started once it's on screen; starting it before can quietly fail.
        if !scanner.isScanning { try? scanner.startScanning() }
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onFound: (String) -> Void
        /// The same code is reported again on every frame it stays in view.
        private var last: String?

        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
                         allItems: [RecognizedItem]) {
            for item in addedItems {
                if case .barcode(let barcode) = item, let text = barcode.payloadStringValue, text != last {
                    last = text
                    onFound(text)
                    return
                }
            }
        }
    }
}
