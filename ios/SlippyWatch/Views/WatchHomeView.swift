import SwiftUI

struct WatchHomeView: View {
    @StateObject private var vm = WatchSessionViewModel()
    @ObservedObject private var connectivity = WatchConnectivityManager.shared

    var body: some View {
        switch vm.phase {
        case .idle:
            idleView
        case .running:
            LiveTrackingView(vm: vm)
        case .paused:
            LiveTrackingView(vm: vm)
        case .ended:
            WatchSummaryView(vm: vm)
        }
    }

    private var idleView: some View {
        VStack(spacing: 12) {
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 36))
                .foregroundColor(.green)

            Text("Slippy Play")
                .font(.headline)
                .foregroundColor(.white)

            // เลือกชนิดกีฬาก่อนเริ่ม — Slippy Play ไม่ได้ตามติดแค่แบดมินตันแล้ว
            Picker("กีฬา", selection: $vm.selectedSport) {
                ForEach(SlippySport.allCases) { sport in
                    Text("\(sport.emoji) \(sport.label)").tag(sport)
                }
            }
            .pickerStyle(.wheel)
            .frame(height: 50)
            .disabled(connectivity.pendingLinkedTitle != nil)

            if let title = connectivity.pendingLinkedTitle {
                VStack(spacing: 2) {
                    Text("ผูกกับนัด")
                        .font(.system(size: 9))
                        .foregroundColor(.gray)
                    Text(title)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.green)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
            }

            Button {
                vm.startSession()
            } label: {
                Text(connectivity.pendingLinkedTitle != nil ? "เริ่มจับเวลานัดนี้" : "เริ่มเล่นแบด")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding()
    }
}
