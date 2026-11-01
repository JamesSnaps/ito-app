import Observation
import SwiftUI

// Pairing (server 1.36.0, app 1.17.0), the web's GN.pairing: a new device
// picks a face and asks, and a device that's already that person says yes.
// A laptop can't scan the add-a-device QR, so this is how it signs in — and
// the iPhone in someone's pocket is usually the device that's them.

/// Requests waiting for this device's profile. The hub polls while it (or
/// You) is on screen, never mid-game; each request is shown once.
@Observable
final class PairWatcher {
    static let shared = PairWatcher()

    /// The request on screen, if any.
    var request: PairRequest?

    @ObservationIgnored private var seen: Set<String> = []

    func check() async {
        guard request == nil, let me = Faces.shared.me else { return }
        guard let waiting = try? await AppSettings.client.pairRequests(token: me.token) else { return }
        if let next = waiting.first(where: { !seen.contains($0.code) }) { show(next) }
    }

    func show(_ found: PairRequest) {
        seen.insert(found.code)
        request = found
    }

    /// A scanned QR: the request with this code, or why there isn't one.
    func review(code: String) async -> String? {
        guard let me = Faces.shared.me else {
            return "This device isn’t signed in as anyone, so it can’t say yes. Make or sign in to your profile on the You screen first."
        }
        do {
            let waiting = try await AppSettings.client.pairRequests(token: me.token)
            guard let found = waiting.first(where: { $0.code == code }) else {
                return "No sign-in request with that code is waiting for \(me.name). It may have run out, or be for someone else."
            }
            show(found)
            return nil
        } catch {
            return error.localizedDescription
        }
    }
}

/// On a device that's you: say yes or no to a new device.
struct PairApprovalSheet: View {
    let request: PairRequest
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var outcome: (title: String, text: String)?

    var body: some View {
        VStack(spacing: 14) {
            if let me = Faces.shared.me { AvatarView(name: me.name, size: 64) }
            if let outcome {
                Text(outcome.title).font(Theme.display(24))
                Text(outcome.text).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                Button("Close") { dismiss() }.buttonStyle(FeltButtonStyle(kind: .ghost))
            } else {
                Text("SIGN-IN REQUEST").font(.caption.weight(.semibold)).tracking(1.2)
                    .foregroundStyle(Theme.cream.opacity(0.6))
                Text("A new device wants to be you").font(Theme.display(24))
                Text("\(request.description). Say yes only if it’s showing this code:")
                    .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                PairCodeView(code: request.code)
                HStack(spacing: 10) {
                    Button("That’s not me") { Task { await answer(false) } }
                        .buttonStyle(FeltButtonStyle(kind: .ghost))
                    Button("Yes, sign it in") { Task { await answer(true) } }
                        .buttonStyle(FeltButtonStyle())
                }
                .disabled(busy)
            }
        }
        .multilineTextAlignment(.center)
        .padding(24)
        .frame(maxWidth: 420)
        .foregroundStyle(Theme.cream)
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.feltDark)
        .preferredColorScheme(.dark)
    }

    private func answer(_ approve: Bool) async {
        guard let me = Faces.shared.me, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await AppSettings.client.answerPair(code: request.code, approve: approve, token: me.token)
            outcome = approve
                ? (title: "Signed in", text: "\(request.device) is signed in as you.")
                : (title: "Turned down", text: "Nothing was signed in.")
            UINotificationFeedbackGenerator().notificationOccurred(approve ? .success : .warning)
        } catch {
            outcome = (title: "That didn’t go through", text: error.localizedDescription)
        }
    }
}

/// This device asks to be `profile`: shows the code and a QR, and waits for
/// one of that person's devices to say yes.
struct PairAskSheet: View {
    let profile: Profile
    @Environment(\.dismiss) private var dismiss
    @State private var ask: PairAsk?
    @State private var problem: String?
    @State private var done = false
    @State private var attempt = 0

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                AvatarView(name: profile.name, size: 72)
                Text(done ? "You’re \(profile.name) here now" : "Be \(profile.name) here?").font(Theme.display(24))
                if done {
                    Text("Your name and photo will follow you into every game on this device.")
                        .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                    Button("Done") { dismiss() }.buttonStyle(FeltButtonStyle())
                } else if let problem {
                    Text(problem).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                    HStack(spacing: 10) {
                        Button("Close") { dismiss() }.buttonStyle(FeltButtonStyle(kind: .ghost))
                        Button("Try again") { self.problem = nil; attempt += 1 }.buttonStyle(FeltButtonStyle())
                    }
                } else if let ask {
                    Text("Open Game Night on \(profile.name)’s phone or iPad and say yes there. It will show this code:")
                        .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
                    PairCodeView(code: ask.code)
                    if let qr = QRCode.image(ask.url) {
                        Image(uiImage: qr).interpolation(.none).resizable()
                            .frame(width: 150, height: 150)
                            .padding(8)
                            .background(.white, in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityLabel("QR code for \(profile.name)’s phone to scan")
                        Text("Or scan this with that phone.").font(.caption).foregroundStyle(Theme.cream.opacity(0.55))
                    }
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small).tint(Theme.goldBright)
                        Text("Waiting for \(profile.name)").font(.subheadline)
                    }
                    Button("Cancel") { dismiss() }.buttonStyle(FeltButtonStyle(kind: .ghost))
                } else {
                    ProgressView().tint(Theme.goldBright).padding()
                }
            }
            .multilineTextAlignment(.center)
            .padding(24)
            .frame(maxWidth: 420)
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(Theme.cream)
        .presentationBackground(Theme.feltDark)
        .preferredColorScheme(.dark)
        .task(id: attempt) { await run() }
        .onDisappear {
            // Closed while still waiting: take the request back off their phone.
            if let ask, !done { Task { await AppSettings.client.cancelPair(code: ask.code, secret: ask.secret) } }
        }
    }

    private func run() async {
        let client = AppSettings.client
        ask = nil
        do {
            ask = try await client.askToPair(profileID: profile.id)
        } catch {
            problem = error.localizedDescription
            return
        }
        guard let ask else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            do {
                let status = try await client.pairStatus(code: ask.code, secret: ask.secret)
                switch status.status {
                case "approved":
                    if let held = status.profile, let token = status.token {
                        Faces.shared.remember(held, token: token)
                        done = true
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                    }
                    return
                case "refused":
                    self.ask = nil
                    problem = "\(profile.name)’s device said no."
                    return
                default:
                    continue
                }
            } catch let failure as GameNightClient.Failure where failure.status == 404 {
                self.ask = nil
                problem = "That request ran out after five minutes."
                return
            } catch {
                continue   // a blip in the signal: keep waiting
            }
        }
    }
}

/// The six characters both screens show, big enough to compare at a glance.
struct PairCodeView: View {
    let code: String

    var body: some View {
        Text(PairRequest.spaced(code))
            .font(Theme.mono(32))
            .tracking(5)
            .foregroundStyle(Theme.goldBright)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityLabel("Code \(code.map(String.init).joined(separator: " "))")
    }
}

/// Everyone's faces to tap: "which of these is you?"
struct PairFacePicker: View {
    let onPick: (Profile) -> Void

    var body: some View {
        let people = Faces.shared.profiles.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 8)], alignment: .leading, spacing: 12) {
            ForEach(people) { person in
                Button { onPick(person) } label: {
                    VStack(spacing: 5) {
                        AvatarView(name: person.name, size: 52)
                        Text(person.name).font(.caption).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("I’m \(person.name)")
            }
        }
    }
}
