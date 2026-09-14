import SwiftUI

/// Mobile counterpart of the web's "AI Assistant" chat — same backend
/// (`/api/chat`, Claude + Life Graph context), so conversations feel like
/// one continuous assistant whether you're on the web or on your phone.
struct ChatView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = ChatViewModel()
    @FocusState private var inputFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 14) {
                            ForEach(vm.messages) { msg in
                                ChatBubble(message: msg)
                                    .id(msg.id)
                            }
                            if vm.isSending {
                                HStack {
                                    typingIndicator
                                    Spacer()
                                }
                                .id("typing")
                            }
                        }
                        .padding(16)
                    }
                    .onChange(of: vm.messages) { _, _ in
                        let target: AnyHashable = vm.messages.last?.id ?? AnyHashable("typing")
                        withAnimation { proxy.scrollTo(target, anchor: .bottom) }
                    }
                    .onChange(of: vm.isSending) { _, sending in
                        guard sending else { return }
                        let target: AnyHashable = "typing"
                        withAnimation { proxy.scrollTo(target, anchor: .bottom) }
                    }
                }

                composer
            }
            .background(Color.background)
            .navigationTitle("ผู้ช่วย AI")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { vm.seedGreeting() }
        }
    }

    private var typingIndicator: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Color.textSecondary.opacity(0.5))
                    .frame(width: 6, height: 6)
                    .scaleEffect(vm.isSending ? 1 : 0.6)
                    .animation(.easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15), value: vm.isSending)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("ถามอะไรก็ได้เกี่ยวกับการเงินของคุณ…", text: $vm.draft, axis: .vertical)
                .focused($inputFocused)
                .lineLimit(1...4)
                .font(.system(size: 14))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.border, lineWidth: 1))

            Button {
                hapticLight()
                let orgId = authVM.org?.id
                Task { await vm.send(orgId: orgId, authVM: authVM) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 38, height: 38)
                    .background(vm.draft.trimmingCharacters(in: .whitespaces).isEmpty ? Color.border : Color.brand500)
                    .clipShape(Circle())
            }
            .disabled(vm.draft.trimmingCharacters(in: .whitespaces).isEmpty || vm.isSending)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.surface.opacity(0.6))
        .overlay(Divider(), alignment: .top)
    }
}

private struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .assistant {
                avatar
                bubble
                Spacer(minLength: 40)
            } else {
                Spacer(minLength: 40)
                bubble
            }
        }
    }

    private var avatar: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color.brand500, Color(hex: "#8b5cf6")],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 28, height: 28)
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.white)
        }
    }

    private var bubble: some View {
        Text(message.content)
            .font(.system(size: 14))
            .foregroundColor(message.role == .user ? .white : Color.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(message.role == .user ? Color.brand500 : Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(message.role == .user ? Color.clear : Color.border, lineWidth: 1)
            )
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return ChatView().environmentObject(vm)
}
#endif
