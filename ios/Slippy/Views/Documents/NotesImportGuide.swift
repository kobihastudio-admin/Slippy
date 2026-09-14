import SwiftUI
import UIKit

/// Explains the only route that genuinely reaches Apple Notes.
///
/// iOS ships no API for reading Notes: there is no NotesKit, the note store is
/// sandboxed, and a scan lives inside the note as an attachment that never
/// touches the photo library unless the user exports it by hand. The picker
/// next to this screen therefore cannot see Notes at all — it reads Photos, and
/// its "Scanned Documents" album only exists if something wrote one.
///
/// The share sheet is the supported hand-off, and Slippy already implements the
/// receiving half (SlippyShare accepts up to 10 files / 20 images and rasterises
/// PDF pages, which is exactly what Notes sends for a scan). All that was
/// missing was telling anyone it exists.
struct NotesImportGuide: View {
    /// Apple publishes no URL scheme for Notes; `mobilenotes:` is the one it
    /// has answered to for years but it is undocumented, so the button only
    /// appears when the system confirms it can open it.
    private static let notesURL = URL(string: "mobilenotes://")

    private var canOpenNotes: Bool {
        guard let url = Self.notesURL else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    private let steps: [(String, String)] = [
        ("1", "เปิดแอป Notes แล้วเปิดโน้ตที่มีเอกสารสแกนอยู่"),
        ("2", "แตะที่เอกสารสแกนเพื่อเปิดขึ้นมาเต็มจอ"),
        ("3", "แตะปุ่มแชร์ (􀈂) มุมขวาบน"),
        ("4", "เลือก Slippy ในแถวแอป — เอกสารจะเข้าระบบทันที"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "square.and.arrow.up.on.square.fill")
                    .font(.system(size: 15))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(Color.brand500)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text("นำเข้าจาก Apple Notes")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color.textPrimary)
                    Text("ส่งตรงจาก Notes ได้เลย ไม่ต้องบันทึกลงคลังภาพก่อน")
                        .font(.system(size: 11))
                        .foregroundColor(Color.textSecondary)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 10) {
                ForEach(steps, id: \.0) { step in
                    HStack(alignment: .top, spacing: 10) {
                        Text(step.0)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(Color.brand500)
                            .frame(width: 20, height: 20)
                            .background(Color.brand500.opacity(0.12))
                            .clipShape(Circle())
                        Text(step.1)
                            .font(.system(size: 13))
                            .foregroundColor(Color.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }

            Text("รองรับทั้งเอกสารสแกน (PDF หลายหน้า) และรูปภาพในโน้ต — ระบบจะแยกทีละหน้าให้เอง")
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if canOpenNotes, let url = Self.notesURL {
                Button {
                    hapticLight()
                    UIApplication.shared.open(url)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.forward.app.fill").font(.system(size: 13, weight: .semibold))
                        Text("เปิดแอป Notes").font(.system(size: 14, weight: .bold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.brand500)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }
}
