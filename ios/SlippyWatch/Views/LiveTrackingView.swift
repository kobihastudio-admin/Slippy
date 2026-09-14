import SwiftUI

struct LiveTrackingView: View {
    @ObservedObject var vm: WatchSessionViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                // Time
                metricRow(icon: "clock", label: "เวลา", value: vm.elapsedFormatted, color: .white)

                // Shots
                metricRow(icon: "sportscourt.fill", label: "ลูก", value: "\(vm.totalShots)", color: .green)

                // Smash
                metricRow(icon: "bolt.fill", label: "Smash", value: "\(vm.smashCount)", color: .yellow)

                // Heart rate
                metricRow(icon: "heart.fill", label: "HR", value: "\(vm.heartRate)", color: .red)

                Divider()

                HStack(spacing: 8) {
                    if vm.phase == .running {
                        Button {
                            vm.pauseSession()
                        } label: {
                            Label("พัก", systemImage: "pause.fill")
                                .font(.caption)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(8)
                                .background(Color.orange)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button {
                            vm.resumeSession()
                        } label: {
                            Label("ต่อ", systemImage: "play.fill")
                                .font(.caption)
                                .foregroundColor(.black)
                                .frame(maxWidth: .infinity)
                                .padding(8)
                                .background(Color.green)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        vm.endSession()
                    } label: {
                        Label("จบ", systemImage: "stop.fill")
                            .font(.caption)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(8)
                            .background(Color.red)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func metricRow(icon: String, label: String, value: String, color: Color) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(color)
                .frame(width: 20)
            Text(label)
                .font(.caption2)
                .foregroundColor(.gray)
            Spacer()
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(color)
        }
    }
}
