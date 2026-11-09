#if DEBUG
import SwiftUI

// Synthetic data for simulator screenshots of the balance UI
// (SLIPPY_APPEARANCE_PREVIEW=friend-balance-test | balance-detail-test).
// No network: BalanceViewModel.isFixture short-circuits its load.

struct FriendBalanceFixtureScreen: View {
    @StateObject private var balances = BalanceViewModel.fixture()
    private let friends = [
        UserProfile(id: MessagesViewModel.fixtureFriendId, email: "ploy@example.invalid", fullName: "พลอย", avatarUrl: nil),
        UserProfile(id: "fx-golf", email: "golf@example.invalid", fullName: "กอล์ฟ", avatarUrl: nil),
        UserProfile(id: "fx-mint", email: "mint@example.invalid", fullName: "มิ้นท์", avatarUrl: nil),
    ]
    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ForEach(friends) { friend in
                    FriendRow(friend: friend, net: balances.summary(for: friend.id)?.net)
                }
            }
            .padding(20)
        }
        .background(Color.background.ignoresSafeArea())
    }
}

struct BalanceDetailFixtureScreen: View {
    @StateObject private var balances = BalanceViewModel.fixture(tripsIncluded: false)
    var body: some View {
        BalanceDetailView(friendId: MessagesViewModel.fixtureFriendId, friendName: "พลอย", vm: balances)
    }
}
#endif
