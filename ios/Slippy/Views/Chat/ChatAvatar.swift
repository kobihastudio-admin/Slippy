import SwiftUI

/// Round avatar for the chat list, chat room, friend picker and add-friend
/// screens: remote image when there is one, otherwise the name's initial.
struct ChatAvatar: View {
    let name: String
    let url: String?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(Color.brand50)
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        initialView
                    }
                }
            } else {
                initialView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initialView: some View {
        Text(ChatPresentation.initial(for: name))
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundColor(Color.accent)
    }
}
