import SwiftUI

struct WatchSummaryView: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(.green)

                Text("จบการเล่น!")
                    .font(.headline)
                    .foregroundColor(.white)

                VStack(spacing: 6) {
                    summaryRow(label: "เวลา",   value: vm.elapsedFormatted)
                    summaryRow(label: "ลูกตี",  value: "\(vm.totalShots)")
                    summaryRow(label: "Smash",   value: "\(vm.smashCount)")
                    summaryRow(label: "HR",      value: "\(vm.heartRate) bpm")
                }

                Text("ข้อมูลถูกส่งไปยัง iPhone แล้ว")
                    .font(.caption2)
                    .foregroundColor(.gray)
                    .multilineTextAlignment(.center)

                Button {
                    // reset
                } label: {
                    Text("เล่นอีกครั้ง")
                        .font(.caption)
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(8)
                        .background(Color.green)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)
        }
    }

    private func summaryRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundColor(.gray)
            Spacer()
            Text(value)
                .font(.caption)
                .bold()
                .foregroundColor(.white)
        }
    }
}
