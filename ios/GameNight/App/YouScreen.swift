import PhotosUI
import SwiftUI

/// "You": the app's /me. A name and a selfie that follow you into every
/// game — made here, or brought over from another device with the QR it
/// shows. `linkCode` is set when the app was opened by one of those QRs.
struct YouScreen: View {
    var linkCode: String?

    @State private var faces = Faces.shared
    @State private var name = ""
    @State private var preview: UIImage?
    @State private var photoItem: PhotosPickerItem?
    @State private var showingCamera = false
    @State private var link: ProfileLink?
    @State private var busy = false
    @State private var message: String?
    @State private var confirmingDelete = false
    @State private var confirmingSignOut = false
    @State private var started = false

    var body: some View {
        ZStack {
            Theme.background
            ScrollView {
                VStack(spacing: 16) {
                    if let me = faces.me {
                        profileCard(me)
                        devicesCard
                        HStack {
                            Button("Sign out here") { confirmingSignOut = true }
                            Spacer()
                            Button("Delete my profile", role: .destructive) { confirmingDelete = true }
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 4)
                    } else {
                        createCard
                    }
                    if let message {
                        Text(message).font(.subheadline).foregroundStyle(Theme.cream.opacity(0.8))
                            .multilineTextAlignment(.center)
                    }
                    // Said before a photo is taken, not after.
                    Text("Your name and photo are shown to anyone using Game Night: the people at the table, the records, and anyone else who has the site’s address. You can remove the photo, or delete the profile, here at any time.")
                        .font(.footnote).foregroundStyle(Theme.cream.opacity(0.55))
                }
                .padding(24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
                .foregroundStyle(Theme.cream)
            }
        }
        .navigationTitle("You")
        .toolbarBackground(Theme.feltDark, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .preferredColorScheme(.dark)
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { image in
                showingCamera = false
                if let image { preview = image }
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    preview = image
                } else {
                    message = "That photo couldn’t be read."
                }
                photoItem = nil
            }
        }
        .confirmationDialog("Sign this device out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out") { Task { await signOut() } }
        } message: {
            Text("The profile stays, for your other devices.")
        }
        .confirmationDialog("Delete your profile?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete profile and photo", role: .destructive) { Task { await delete() } }
        } message: {
            Text("It goes from every device. Past games keep the name.")
        }
        .task { await start() }
    }

    // MARK: - cards

    private var createCard: some View {
        Panel(title: "Make your profile") {
            Text("Use the name you play under — the records already know it, so your past games come with it.")
                .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
            TextField("Your name", text: $name)
                .textContentType(.nickname)
                .submitLabel(.done)
                .onSubmit { Task { await create() } }
                .padding(12)
                .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 10))
            Button(busy ? "Making it…" : "Make my profile") { Task { await create() } }
                .buttonStyle(FeltButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            Text("Already made one on another phone? Open You there, tap Add another device, and scan its code with this one.")
                .font(.caption).foregroundStyle(Theme.cream.opacity(0.55))
        }
    }

    private func profileCard(_ me: HeldMe) -> some View {
        VStack(spacing: 14) {
            Group {
                if let preview {
                    Image(uiImage: preview).resizable().scaledToFill()
                } else {
                    AvatarView(name: me.name, size: 168)
                }
            }
            .frame(width: 168, height: 168)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Theme.cream.opacity(0.2), lineWidth: 4))
            .shadow(color: .black.opacity(0.4), radius: 12, y: 6)

            Text(me.name).font(Theme.display(26))

            if preview != nil {
                Button(busy ? "Saving…" : "Use this photo") { Task { await savePhoto() } }
                    .buttonStyle(FeltButtonStyle())
                    .disabled(busy)
                Button("Try again") { preview = nil; openCamera() }
                    .buttonStyle(FeltButtonStyle(kind: .ghost))
            } else {
                Button { openCamera() } label: {
                    Label(me.photo == nil ? "Take a selfie" : "Take a new selfie", systemImage: "camera")
                }
                .buttonStyle(FeltButtonStyle())
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label("Choose a photo", systemImage: "photo")
                }
                .buttonStyle(FeltButtonStyle(kind: .ghost))
                if me.photo != nil {
                    Button("Remove photo") { Task { await removePhoto() } }
                        .font(.subheadline)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(Theme.cream.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }

    private var devicesCard: some View {
        Panel(title: "Your other devices") {
            Text("Scan this with your iPad or another phone to sign it in as you too. It works once, for ten minutes.")
                .font(.subheadline).foregroundStyle(Theme.cream.opacity(0.75))
            if let link, let qr = QRCode.image(link.url) {
                Image(uiImage: qr).interpolation(.none).resizable()
                    .frame(width: 200, height: 200)
                    .padding(10)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12))
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("QR code to add another device")
            } else {
                Button("Add another device") { Task { await makeLink() } }
                    .buttonStyle(FeltButtonStyle(kind: .ghost))
            }
        }
    }

    // MARK: - actions

    private var client: GameNightClient { AppSettings.client }

    private func start() async {
        // Once per visit: closing the camera re-runs `.task`, and a sign-in
        // link redeemed a second time reads as expired.
        guard !started else { return }
        started = true
        await faces.load(force: true)
        if let linkCode {
            do {
                let held = try await client.redeemLink(code: linkCode)
                faces.remember(held.profile, token: held.token)
                message = "This device is now \(held.profile.name)."
            } catch {
                message = error.localizedDescription
            }
        } else if let me = Me.current {
            // The profile may have been deleted on another device.
            do {
                faces.remember(try await client.myProfile(token: me.token))
            } catch let failure as GameNightClient.Failure where failure.status == 403 {
                faces.forget(deleted: false)
            } catch {}
        }
    }

    private func create() async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let held = try await client.createProfile(name: trimmed)
            faces.remember(held.profile, token: held.token)
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    private func openCamera() {
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            showingCamera = true
        } else {
            message = "This device has no camera — choose a photo instead."
        }
    }

    private func savePhoto() async {
        guard let preview, let me = faces.me, !busy else { return }
        guard let jpeg = Self.squareJPEG(preview) else { message = "That photo couldn’t be used."; return }
        busy = true
        defer { busy = false }
        do {
            faces.remember(try await client.uploadPhoto(jpeg, token: me.token))
            self.preview = nil
            message = "Looking good."
        } catch {
            message = error.localizedDescription
        }
    }

    private func removePhoto() async {
        guard let me = faces.me else { return }
        do { faces.remember(try await client.removePhoto(token: me.token)) } catch { message = error.localizedDescription }
    }

    private func makeLink() async {
        guard let me = faces.me else { return }
        do {
            let made = try await client.linkAnotherDevice(token: me.token)
            link = made
            try? await Task.sleep(for: .seconds(made.expiresIn))
            if link == made { link = nil }
        } catch {
            message = error.localizedDescription
        }
    }

    private func signOut() async {
        guard let me = faces.me else { return }
        try? await client.forgetThisDevice(token: me.token)
        faces.forget(deleted: false)
        message = nil
    }

    private func delete() async {
        guard let me = faces.me else { return }
        do {
            try await client.deleteProfile(token: me.token)
            faces.forget(deleted: true)
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    /// A square crop, faces sitting a little above the middle, as a JPEG.
    /// Drawing it afresh keeps nothing else the camera wrote into the file;
    /// the server redraws it again anyway.
    static func squareJPEG(_ image: UIImage, side: CGFloat = 640) -> Data? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let scale = side / min(size.width, size.height)
        let drawn = CGSize(width: size.width * scale, height: size.height * scale)
        let origin = CGPoint(x: (side - drawn.width) / 2, y: (side - drawn.height) * 0.42)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let square = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(origin: origin, size: drawn))
        }
        return square.jpegData(compressionQuality: 0.88)
    }
}

/// The camera, front-facing, for a selfie. `onDone(nil)` if cancelled.
struct CameraPicker: UIViewControllerRepresentable {
    let onDone: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        if UIImagePickerController.isCameraDeviceAvailable(.front) { picker.cameraDevice = .front }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (UIImage?) -> Void
        init(onDone: @escaping (UIImage?) -> Void) { self.onDone = onDone }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onDone(nil)
        }
    }
}
