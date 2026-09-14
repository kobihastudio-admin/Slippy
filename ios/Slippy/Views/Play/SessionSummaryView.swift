import SwiftUI

struct SessionSummaryView: View {
    let session: SportSession
    @Environment(\.dismiss) private var dismiss

    private var smashPct: Int { Int(session.smashRatio * 100) }
    private var sport: SlippySport { SlippySport(rawValue: session.sport) ?? .badminton }
    // ใช้ insight ที่บันทึกไว้แล้วถ้ามี (จาก AIInsightGenerator ตอน sync) ไม่งั้น
    // คำนวณสดเฉพาะข้อความ (รองรับ session เก่าก่อนมี insight fields)
    private var insight: AIInsight {
        if let text = session.insightText, let skill = session.skillScore,
           let power = session.powerScore, let stamina = session.staminaScore,
           let consistency = session.consistencyScore {
            return AIInsight(text: text, skillScore: skill, powerScore: power, staminaScore: stamina, consistencyScore: consistency)
        }
        return AIInsightGenerator.generate(for: session)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {

                    // Hero
                    heroCard

                    // Shot breakdown
                    shotCard

                    // Health
                    healthCard

                    // AI Insight
                    insightCard

                    // Share
                    shareButton
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Color(hex: "#f0fdf4").ignoresSafeArea())
            .navigationTitle("สรุปการเล่น")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }
                }
            }
        }
    }

    // MARK: – Hero

    private var heroCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 44))
                .foregroundColor(Color(hex: "#16a34a"))

            Text("\(sport.emoji) \(sport.label)")
                .font(.system(size: 13))
                .foregroundColor(.secondary)

            Text(session.durationFormatted)
                .font(.system(size: 40, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#15803d"))

            Text(session.startedAt, style: .date)
                .font(.system(size: 13))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 3)
    }

    // MARK: – Shots

    private var shotCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("สถิติการตี")
                .font(.system(size: 15, weight: .bold))

            HStack(spacing: 0) {
                statBlock(value: "\(session.totalShots)", label: "ลูกตีทั้งหมด", color: Color(hex: "#16a34a"))
                statBlock(value: "\(session.smashCount)", label: "Smash",          color: Color(hex: "#f59e0b"))
                statBlock(value: "\(smashPct)%",          label: "Smash Ratio",    color: Color(hex: "#f97316"))
            }

            // Smash ratio bar
            VStack(alignment: .leading, spacing: 6) {
                Text("Smash Ratio")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 6).fill(Color(hex: "#dcfce7")).frame(height: 12)
                        RoundedRectangle(cornerRadius: 6).fill(Color(hex: "#16a34a"))
                            .frame(width: geo.size.width * session.smashRatio, height: 12)
                    }
                }
                .frame(height: 12)
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    // MARK: – Health

    private var healthCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("สุขภาพ")
                .font(.system(size: 15, weight: .bold))

            HStack(spacing: 0) {
                if let avg = session.avgHeartRate {
                    statBlock(value: "\(avg)", label: "HR เฉลี่ย", color: .red)
                }
                if let max = session.maxHeartRate {
                    statBlock(value: "\(max)", label: "HR สูงสุด", color: Color(hex: "#dc2626"))
                }
                if let cal = session.activeCalories {
                    statBlock(value: "\(Int(cal))", label: "แคลอรี่", color: Color(hex: "#f97316"))
                }
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
    }

    // MARK: – AI Insight

    private var insightCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "brain.head.profile")
                    .foregroundColor(Color(hex: "#8b5cf6"))
                Text("คำแนะนำจาก Nova Coach")
                    .font(.system(size: 15, weight: .bold))
            }

            Text(insight.text)
                .font(.system(size: 14))
                .foregroundColor(Color(hex: "#374151"))
                .lineSpacing(4)

            HStack(spacing: 0) {
                scoreBlock(value: insight.skillScore,       label: "ฝีมือ")
                scoreBlock(value: insight.powerScore,       label: "พลัง")
                scoreBlock(value: insight.staminaScore,     label: "ความฟิต")
                scoreBlock(value: insight.consistencyScore, label: "ความสม่ำเสมอ")
            }
        }
        .padding(16)
        .background(Color(hex: "#faf5ff"))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: "#e9d5ff"), lineWidth: 1))
    }

    private func scoreBlock(value: Int, label: String) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.system(size: 18, weight: .black, design: .rounded))
                .foregroundColor(Color(hex: "#8b5cf6"))
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: – Share

    private var shareButton: some View {
        Button {
            shareToLine()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "square.and.arrow.up")
                Text("แชร์ไป LINE")
                    .font(.system(size: 15, weight: .bold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color(hex: "#06C755"))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: – Helpers

    private func statBlock(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 20, weight: .black, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func shareToLine() {
        let text = """
        วันนี้เล่น\(sport.label)กับ Slippy Play \(sport.emoji)
        เวลาเล่น: \(session.durationFormatted)
        จำนวนลูกตี: \(session.totalShots)
        Smash: \(session.smashCount) ครั้ง
        \(session.avgHeartRate.map { "Avg HR: \($0) bpm" } ?? "")
        #SlippyPlay #\(sport.label)
        """
        let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if let url = URL(string: "line://msg/text/?\(encoded)") {
            UIApplication.shared.open(url)
        }
    }
}
