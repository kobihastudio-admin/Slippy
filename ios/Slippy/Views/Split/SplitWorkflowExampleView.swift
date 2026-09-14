import SwiftUI

/// A polished product concept screen for the split-bill workflow.
/// This is intentionally read-only: it helps validate UX direction before
/// wiring every interaction into CreateSplitView.
struct SplitWorkflowExampleView: View {
    @State private var selectedStep: WorkflowStep = .scan

    private enum WorkflowStep: Int, CaseIterable, Identifiable {
        case scan = 1
        case review
        case split
        case collect

        var id: Int { rawValue }

        var title: String {
            switch self {
            case .scan: return "สแกนบิล"
            case .review: return "ตรวจรายการ"
            case .split: return "แบ่งกับเพื่อน"
            case .collect: return "เก็บเงิน"
            }
        }

        var subtitle: String {
            switch self {
            case .scan: return "ถ่ายรูปหรือเลือกรูปใบเสร็จ"
            case .review: return "AI อ่านยอด ร้านค้า VAT และรายการอาหาร"
            case .split: return "เลือกวิธีหารและปรับยอดรายคน"
            case .collect: return "แชร์ลิงก์ ติดตามสถานะ และปิดยอด"
            }
        }

        var icon: String {
            switch self {
            case .scan: return "doc.text.viewfinder"
            case .review: return "sparkles"
            case .split: return "person.2.fill"
            case .collect: return "qrcode"
            }
        }

        var tint: Color {
            switch self {
            case .scan: return Color(hex: "#6366f1")
            case .review: return Color(hex: "#8b5cf6")
            case .split: return Color(hex: "#db2777")
            case .collect: return Color(hex: "#16a34a")
            }
        }
    }

    private struct FriendShare: Identifiable {
        let id = UUID()
        let name: String
        let amount: Double
        let color: Color
        let paid: Bool
    }

    private let friends = [
        FriendShare(name: "มายด์", amount: 420, color: Color(hex: "#db2777"), paid: true),
        FriendShare(name: "ต้น", amount: 390, color: Color(hex: "#6366f1"), paid: false),
        FriendShare(name: "บีม", amount: 465, color: Color(hex: "#16a34a"), paid: false)
    ]

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: "#f4f3ff"), Color(hex: "#fff7fb"), Color.white],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    heroCard
                    stepSelector
                    activeStepPreview
                    workflowTimeline
                    designNotes
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("Workflow หารบิล")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var heroCard: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(hex: "#7c72f5"), Color(hex: "#6366f1"), Color(hex: "#db2777")],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            GeometryReader { geo in
                Circle()
                    .fill(Color.white.opacity(0.12))
                    .frame(width: 150, height: 150)
                    .position(x: geo.size.width * 0.86, y: 38)
                Circle()
                    .fill(Color.white.opacity(0.09))
                    .frame(width: 92, height: 92)
                    .position(x: geo.size.width * 0.73, y: 138)
                Image(systemName: "receipt.fill")
                    .font(.system(size: 72, weight: .bold))
                    .foregroundColor(.white.opacity(0.18))
                    .rotationEffect(.degrees(-10))
                    .position(x: geo.size.width * 0.82, y: 112)
            }

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16)
                            .fill(Color.white.opacity(0.18))
                            .frame(width: 52, height: 52)
                        Image(systemName: "person.2.wave.2.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    Spacer()
                    Text("ตัวอย่าง UX")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.white.opacity(0.16))
                        .clipShape(Capsule())
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Dinner at Thonglor")
                        .font(.system(size: 28, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                    Text("จากใบเสร็จหนึ่งใบ สู่ยอดรายคนพร้อมลิงก์ชำระในไม่กี่แตะ")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white.opacity(0.78))
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 10) {
                    metricPill("ยอดรวม", fmtTHB(1275))
                    metricPill("สมาชิก", "4 คน")
                    metricPill("สถานะ", "2 รอจ่าย")
                }
            }
            .padding(20)
        }
        .frame(height: 248)
        .shadow(color: Color(hex: "#6366f1").opacity(0.26), radius: 20, x: 0, y: 12)
    }

    private func metricPill(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.white.opacity(0.68))
            Text(value)
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.white.opacity(0.14))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var stepSelector: some View {
        HStack(spacing: 8) {
            ForEach(WorkflowStep.allCases) { step in
                Button {
                    hapticLight()
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                        selectedStep = step
                    }
                } label: {
                    VStack(spacing: 7) {
                        ZStack {
                            Circle()
                                .fill(selectedStep == step ? step.tint : Color.white)
                                .frame(width: 42, height: 42)
                                .shadow(color: selectedStep == step ? step.tint.opacity(0.22) : .clear, radius: 8, y: 4)
                            Image(systemName: step.icon)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(selectedStep == step ? .white : Color.textSecondary)
                        }
                        Text(step.title)
                            .font(.system(size: 10.5, weight: selectedStep == step ? .bold : .medium))
                            .foregroundColor(selectedStep == step ? Color(hex: "#1e1b4b") : Color.textSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 10, x: 0, y: 4)
    }

    @ViewBuilder
    private var activeStepPreview: some View {
        switch selectedStep {
        case .scan:
            scanPreview
        case .review:
            reviewPreview
        case .split:
            splitPreview
        case .collect:
            collectPreview
        }
    }

    private var scanPreview: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(selectedStep)
            HStack(spacing: 12) {
                scanOption(icon: "camera.fill", title: "ถ่ายบิล", subtitle: "เปิดกล้องทันที", tint: Color(hex: "#6366f1"))
                scanOption(icon: "photo.on.rectangle", title: "เลือกรูป", subtitle: "เลือกได้หลายใบ", tint: Color(hex: "#db2777"))
            }
            receiptMockCard
        }
        .sectionShell()
    }

    private func scanOption(icon: String, title: String, subtitle: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: 42, height: 42)
                .background(tint.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.textPrimary)
            Text(subtitle)
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(hex: "#f9fafb"))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var receiptMockCard: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Thonglor Table")
                    .font(.system(size: 14, weight: .bold))
                Spacer()
                Text("OCR 96%")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Color(hex: "#16a34a"))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Color(hex: "#dcfce7"))
                    .clipShape(Capsule())
            }
            receiptLine("Pasta Set", "฿520")
            receiptLine("Salad", "฿260")
            receiptLine("Drinks", "฿360")
            Divider()
            receiptLine("VAT 7%", "฿83.41", bold: false)
            receiptLine("Total", fmtTHB(1275), bold: true)
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border, lineWidth: 1))
    }

    private func receiptLine(_ left: String, _ right: String, bold: Bool = false) -> some View {
        HStack {
            Text(left)
            Spacer()
            Text(right)
        }
        .font(.system(size: 12, weight: bold ? .bold : .medium))
        .foregroundColor(bold ? Color.textPrimary : Color.textSecondary)
    }

    private var reviewPreview: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(selectedStep)
            VStack(spacing: 10) {
                editableRow(icon: "storefront.fill", label: "ร้านค้า", value: "Thonglor Table", tint: Color(hex: "#6366f1"))
                editableRow(icon: "calendar", label: "วันที่", value: "วันนี้ 19:42", tint: Color(hex: "#8b5cf6"))
                editableRow(icon: "banknote.fill", label: "ยอดรวม", value: fmtTHB(1275), tint: Color(hex: "#16a34a"))
            }
            HStack(spacing: 10) {
                confidenceChip("ยอดเงิน", "สูง")
                confidenceChip("VAT", "ตรวจแล้ว")
                confidenceChip("รายการ", "5 แถว")
            }
        }
        .sectionShell()
    }

    private func editableRow(icon: String, label: String, value: String, tint: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: 38, height: 38)
                .background(tint.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 11))
                    .foregroundColor(Color.textSecondary)
                Text(value)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
            }
            Spacer()
            Image(systemName: "pencil")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.textSecondary)
        }
        .padding(12)
        .background(Color(hex: "#f9fafb"))
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
    }

    private func confidenceChip(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(Color.textSecondary)
            Text(value)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Color(hex: "#16a34a"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color(hex: "#dcfce7").opacity(0.65))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var splitPreview: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(selectedStep)
            HStack(spacing: 8) {
                modeChip("เท่ากัน", active: false)
                modeChip("ตามรายการ", active: true)
                modeChip("%", active: false)
            }
            VStack(spacing: 10) {
                ForEach(friends) { friend in
                    friendRow(friend)
                }
            }
        }
        .sectionShell()
    }

    private func modeChip(_ label: String, active: Bool) -> some View {
        Text(label)
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(active ? .white : Color.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(active ? Color(hex: "#6366f1") : Color(hex: "#f3f4f6"))
            .clipShape(Capsule())
    }

    private func friendRow(_ friend: FriendShare) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(friend.color.opacity(0.14)).frame(width: 42, height: 42)
                Text(friend.name.prefix(1))
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(friend.color)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Text(friend.paid ? "ชำระแล้ว" : "รอลิงก์ชำระ")
                    .font(.system(size: 11))
                    .foregroundColor(friend.paid ? Color(hex: "#16a34a") : Color.textSecondary)
            }
            Spacer()
            Text(fmtTHB(friend.amount))
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(Color.textPrimary)
        }
        .padding(12)
        .background(Color(hex: "#f9fafb"))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var collectPreview: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader(selectedStep)
            HStack(spacing: 12) {
                qrMock
                VStack(alignment: .leading, spacing: 10) {
                    Text("แชร์เข้ากลุ่ม LINE")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color.textPrimary)
                    Text("เพื่อนเปิดลิงก์ ตรวจยอดตัวเอง แล้วแนบหลักฐานได้ทันที")
                        .font(.system(size: 12))
                        .foregroundColor(Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                        Text("มายด์จ่ายแล้ว")
                    }
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Color(hex: "#16a34a"))
                }
                Spacer(minLength: 0)
            }
            progressBar
        }
        .sectionShell()
    }

    private var qrMock: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18)
                .fill(Color.white)
                .frame(width: 108, height: 108)
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border, lineWidth: 1))
            VStack(spacing: 5) {
                HStack(spacing: 5) {
                    qrBlock(size: 24)
                    qrBlock(size: 24)
                    qrBlock(size: 24)
                }
                HStack(spacing: 5) {
                    qrBlock(size: 24)
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: "#6366f1")).frame(width: 24, height: 24)
                    qrBlock(size: 24)
                }
                HStack(spacing: 5) {
                    qrBlock(size: 24)
                    qrBlock(size: 24)
                    qrBlock(size: 24)
                }
            }
        }
    }

    private func qrBlock(size: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color(hex: "#1e1b4b"))
            .frame(width: size, height: size)
            .opacity(0.88)
    }

    private var progressBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ความคืบหน้า")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                Spacer()
                Text("1/3 ชำระแล้ว")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Color(hex: "#6366f1"))
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(hex: "#e5e7eb")).frame(height: 9)
                    Capsule().fill(Color(hex: "#6366f1")).frame(width: geo.size.width * 0.34, height: 9)
                }
            }
            .frame(height: 9)
        }
        .padding(12)
        .background(Color(hex: "#f9fafb"))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var workflowTimeline: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("ลำดับประสบการณ์ที่ควรได้")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(Color(hex: "#1e1b4b"))

            VStack(spacing: 0) {
                ForEach(WorkflowStep.allCases) { step in
                    Button {
                        hapticLight()
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                            selectedStep = step
                        }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                ZStack {
                                    Circle()
                                        .fill(selectedStep == step ? step.tint : step.tint.opacity(0.12))
                                        .frame(width: 34, height: 34)
                                    Text("\(step.rawValue)")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(selectedStep == step ? .white : step.tint)
                                }
                                if step != WorkflowStep.allCases.last {
                                    Rectangle()
                                        .fill(Color(hex: "#e5e7eb"))
                                        .frame(width: 2, height: 34)
                                }
                            }

                            VStack(alignment: .leading, spacing: 4) {
                                Text(step.title)
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(Color.textPrimary)
                                Text(step.subtitle)
                                    .font(.system(size: 12))
                                    .foregroundColor(Color.textSecondary)
                            }
                            Spacer()
                            Image(systemName: selectedStep == step ? "checkmark.circle.fill" : "chevron.right")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(selectedStep == step ? step.tint : Color.textSecondary.opacity(0.55))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .sectionShell()
    }

    private var designNotes: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("หลัก UX ที่หน้าจอนี้ตั้งใจสื่อ")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(Color(hex: "#1e1b4b"))
            designNote(icon: "bolt.fill", title: "เริ่มจากสแกนเร็ว", body: "ปุ่มกล้องและเลือกรูปต้องเด่น เพราะเป็น entry point หลักของงาน")
            designNote(icon: "checkmark.seal.fill", title: "ให้ AI ช่วย แต่ผู้ใช้คุมได้", body: "ทุก field ที่ OCR อ่านควรแก้ไขได้ก่อนส่งให้เพื่อน")
            designNote(icon: "person.2.fill", title: "เห็นยอดรายคนทันที", body: "ลดความลังเลด้วยการโชว์ยอด เพื่อน และสถานะในหน้าจอเดียว")
        }
        .sectionShell()
    }

    private func designNote(icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color(hex: "#6366f1"))
                .frame(width: 30, height: 30)
                .background(Color(hex: "#ede9fe"))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Color.textPrimary)
                Text(body)
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func sectionHeader(_ step: WorkflowStep) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: step.icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 42, height: 42)
                .background(step.tint)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("Step \(step.rawValue): \(step.title)")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Color(hex: "#1e1b4b"))
                Text(step.subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
            }
            Spacer()
        }
    }
}

private extension View {
    func sectionShell() -> some View {
        self
            .padding(16)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .shadow(color: .black.opacity(0.04), radius: 10, x: 0, y: 4)
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        SplitWorkflowExampleView()
    }
}
#endif
