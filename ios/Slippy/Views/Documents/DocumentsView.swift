import SwiftUI

struct DocumentsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm   = DocumentsViewModel()
    @State private var showCamera = false
    @State private var docToDelete: SlippyDocument?
    var initialFilter: String? = nil

    private let filterChips = [
        ("ทั้งหมด", nil as String?),
        ("ตรวจสอบ", "reviewing"),
        ("อนุมัติ",  "approved"),
        ("ส่งแล้ว", "pushed"),
        ("ผิดพลาด", "failed"),
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                periodSwitcher
                if vm.period != .all { periodStepper }
                summaryCard
                searchBar
                filterRow
                Divider()
                if vm.isLoading {
                    Spacer()
                    SlippyLoadingView(message: "กำลังโหลดเอกสาร...")
                    Spacer()
                } else if vm.documents.isEmpty {
                    emptyState
                } else {
                    docList
                }
            }
            .background(Color(hex: "#f8f9fc"))
            .navigationTitle("เอกสาร")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showCamera = true } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Color.brand500)
                    }
                }
            }
            .task {
                guard let orgId = authVM.org?.id else { return }
                if let initialFilter { vm.filterStatus = initialFilter }
                await vm.load(orgId: orgId)
            }
            .onChange(of: authVM.org?.id) { _, newOrgId in
                guard let orgId = newOrgId else { return }
                Task { await vm.load(orgId: orgId) }
            }
            .sheet(isPresented: $showCamera) {
                CameraPickerView(onUploadSuccess: {
                    if let orgId = authVM.org?.id {
                        Task { await vm.load(orgId: orgId) }
                    }
                })
            }
            .alert("ลบเอกสารนี้?", isPresented: Binding(
                get: { docToDelete != nil },
                set: { if !$0 { docToDelete = nil } }
            )) {
                Button("ลบ", role: .destructive) {
                    if let doc = docToDelete {
                        Task { _ = await vm.deleteDocument(doc) }
                    }
                    docToDelete = nil
                }
                Button("ยกเลิก", role: .cancel) { docToDelete = nil }
            } message: {
                Text("ไม่สามารถกู้คืนได้หลังจากลบแล้ว")
            }
            .alert("ผิดพลาด", isPresented: Binding(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("ตกลง", role: .cancel) { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
        }
    }

    // MARK: – Search bar
    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(Color.textSecondary)
            TextField("ค้นหาชื่อผู้ขาย…", text: $vm.searchText)
                .onChange(of: vm.searchText) { _, q in
                    Task { await vm.search(query: q) }
                }
        }
        .padding(12)
        .background(Color.surface)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: – Filter chips
    private var filterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filterChips, id: \.0) { label, status in
                    let active = vm.filterStatus == status
                    Button {
                        hapticLight()
                        Task { await vm.applyFilter(status: status) }
                    } label: {
                        Text(label)
                            .font(.system(size: 13, weight: active ? .bold : .medium))
                            .foregroundColor(active ? .white : Color.textSecondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(active ? Color.brand500 : Color.surface)
                            .cornerRadius(20)
                            .overlay(
                                Capsule().stroke(active ? Color.brand500 : Color.border)
                            )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    // MARK: – List, grouped by the day each document belongs to

    private var docList: some View {
        List {
            ForEach(vm.days, id: \.date) { group in
                Section {
                    ForEach(group.documents) { doc in
                        NavigationLink { DocumentDetailView(doc: doc, documents: vm.documents) } label: {
                            DocumentCard(doc: doc)
                        }
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            // Same icon/color as the swipe-to-delete row on Dashboard
                            // (SwipeActionsRow's deleteAction) — native .swipeActions
                            // here since this row lives in a List, not a custom VStack.
                            Button(role: .destructive) {
                                hapticMedium()
                                docToDelete = doc
                            } label: {
                                Label("ลบ", systemImage: "trash.fill")
                            }
                            .tint(Color.statusFailed)
                        }
                    }
                } header: {
                    dayHeader(date: group.date, documents: group.documents)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    /// Per-day header carrying that day's own total, so a month view answers
    /// "which day did the money go?" without opening anything.
    private func dayHeader(date: Date, documents docs: [SlippyDocument]) -> some View {
        HStack {
            Text(dayLabel(date))
                .font(.system(size: 12.5, weight: .bold))
                .foregroundColor(Color.textPrimary)
            Text("\(docs.count) ฉบับ")
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
            Spacer()
            Text(fmtTHB(vm.dayTotal(docs)))
                .font(.system(size: 12.5, weight: .bold))
                .foregroundColor(Color.brand500)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .textCase(nil)
    }

    private func dayLabel(_ date: Date) -> String {
        if Calendar.current.isDateInToday(date)     { return "วันนี้" }
        if Calendar.current.isDateInYesterday(date) { return "เมื่อวาน" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "th_TH")
        f.setLocalizedDateFormatFromTemplate("EEEEdMMM")
        return f.string(from: date)
    }

    // MARK: – Period controls

    private var periodSwitcher: some View {
        Picker("", selection: Binding(
            get: { vm.period },
            set: { vm.setPeriod($0) }
        )) {
            ForEach(DocumentPeriod.allCases, id: \.self) { p in
                Text(p.label).tag(p)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var periodStepper: some View {
        HStack {
            Button { hapticLight(); vm.step(-1) } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color.brand500)
                    .frame(width: 40, height: 34)
            }
            Spacer()
            Text(vm.periodLabel)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(Color.textPrimary)
            Spacer()
            Button { hapticLight(); vm.step(1) } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    // Paging into the future finds nothing; dim rather than hide
                    // so the control does not jump around.
                    .foregroundColor(vm.isCurrentPeriod ? Color.textSecondary.opacity(0.35) : Color.brand500)
                    .frame(width: 40, height: 34)
            }
            .disabled(vm.isCurrentPeriod)
        }
        .padding(.horizontal, 12)
    }

    private var summaryCard: some View {
        let s = vm.summary
        return HStack(spacing: 0) {
            summaryCell(label: "เอกสาร", value: "\(s.count)", tint: Color.textPrimary)
            Divider().frame(height: 30)
            summaryCell(label: "ยอดรวม", value: fmtTHB(s.total), tint: Color.brand500)
            Divider().frame(height: 30)
            summaryCell(label: "VAT", value: fmtTHB(s.vat), tint: Color.textPrimary)
            if s.needsFix > 0 {
                Divider().frame(height: 30)
                summaryCell(label: "ต้องแก้", value: "\(s.needsFix)", tint: Color(hex: "#f59e0b"))
            }
            if s.duplicates > 0 {
                Divider().frame(height: 30)
                summaryCell(label: "ซ้ำ", value: "\(s.duplicates)", tint: Color.statusFailed)
            }
        }
        .padding(.vertical, 10)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func summaryCell(label: String, value: String, tint: Color) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 15, weight: .heavy))
                .foregroundColor(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 10.5))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyStateDetail: String {
        switch vm.period {
        case .day:   return "ไม่มีเอกสารในวันนี้ — ลองเลื่อนไปวันก่อนหน้า หรือแตะ \"ทั้งหมด\" ด้านบนเพื่อดูทุกเอกสาร"
        case .month: return "ไม่มีเอกสารในเดือนนี้ — ลองเลื่อนไปเดือนก่อนหน้า หรือแตะ \"ทั้งหมด\" ด้านบนเพื่อดูทุกเอกสาร"
        case .all:   return "ยังไม่มีเอกสารในองค์กรนี้เลย — แตะ + เพื่อสแกนใบแรก"
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "tray.fill")
                .font(.system(size: 48))
                .foregroundColor(Color.border)
            Text("ไม่พบเอกสาร")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color.textSecondary)
            Text(emptyStateDetail)
                .font(.system(size: 13))
                .foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
        }
    }
}

#if DEBUG
#Preview {
    let vm = AuthViewModel(_preview: true)
    vm.setPreviewData(
        profile: UserProfile(id: "u1", email: "demo@slippy.app", fullName: "สมชาย ใจดี", avatarUrl: nil),
        org: Organization(id: "demo-org", name: "บริษัท Demo จำกัด", plan: "pro", docQuota: 200, docUsed: 45)
    )
    return DocumentsView().environmentObject(vm)
}
#endif

// MARK: – DocumentCard
struct DocumentCard: View {
    let doc: SlippyDocument

    /// Small, specific, and always says WHAT is wrong — a bare "ตรวจสอบ" badge
    /// makes the user open the document to find out whether it matters.
    private func reviewBadge(_ text: String, _ icon: String, _ tint: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 8, weight: .bold))
            Text(text).font(.system(size: 10, weight: .semibold)).lineLimit(1)
        }
        .foregroundColor(tint)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(tint.opacity(0.12))
        .clipShape(Capsule())
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                // Icon
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 20))
                    .foregroundColor(Color.brand500)
                    .frame(width: 44, height: 44)
                    .background(Color.brand50)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                // Info
                VStack(alignment: .leading, spacing: 3) {
                    Text(doc.vendorName ?? doc.fileName)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(Color.textPrimary)
                        .lineLimit(1)
                    // Both signals were computed server-side and stored, and
                    // neither had anywhere to appear until now — a duplicate
                    // and a misread both looked exactly like a normal row.
                    if doc.isDuplicateDocument || doc.needsCorrection {
                        HStack(spacing: 5) {
                            if doc.isDuplicateDocument {
                                reviewBadge("ซ้ำ", "doc.on.doc.fill", Color.statusFailed)
                            }
                            if doc.needsCorrection {
                                reviewBadge(doc.correctionSummary, "exclamationmark.triangle.fill",
                                            Color(hex: "#f59e0b"))
                            }
                        }
                        .padding(.top, 1)
                    }
                    if let inv = doc.invoiceNumber {
                        Text(inv)
                            .font(.system(size: 12))
                            .foregroundColor(Color.textSecondary)
                    }
                    if let cat = doc.category {
                        Text(cat)
                            .font(.system(size: 11))
                            .foregroundColor(Color.brand500)
                    }
                }

                Spacer()

                // Amount + status
                VStack(alignment: .trailing, spacing: 4) {
                    if let amt = doc.totalAmount {
                        Text(fmtTHB(amt))
                            .font(.system(size: 15, weight: .heavy))
                            .foregroundColor(Color.textPrimary)
                    }
                    StatusBadge(status: doc.status)
                }
            }

            // Confidence bar
            if let conf = doc.overallConfidence {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.system(size: 10))
                        .foregroundColor(Color.textSecondary)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.border).frame(height: 3)
                            Capsule()
                                .fill(conf > 0.9 ? Color.statusApproved : Color.statusReviewing)
                                .frame(width: geo.size.width * conf, height: 3)
                        }
                    }
                    .frame(height: 3)
                    Text("\(Int(conf * 100))%")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color.textSecondary)
                }
                .padding(.top, 10)
            }
        }
        .padding(14)
        .background(Color.surface)
        .cornerRadius(16)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.border))
    }
}
