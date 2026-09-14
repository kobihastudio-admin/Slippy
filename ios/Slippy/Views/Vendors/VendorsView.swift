import SwiftUI

/// Mobile counterpart of `web/src/app/(app)/vendors/page.tsx` +
/// `vendors-client.tsx` — same `vendors` table, same category taxonomy,
/// same brand-emoji/colour heuristics, so vendor data looks identical
/// whether viewed on web or mobile.
struct VendorsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var vm = VendorsViewModel()
    @State private var editingVendor: Vendor?

    // No NavigationStack here — always reached via a push from Profile or
    // the "เพิ่มเติม" hub, both of which already own one.
    var body: some View {
            Group {
                if vm.isLoading && vm.vendors.isEmpty {
                    loadingSkeleton
                } else if vm.filtered.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("ผู้ขาย")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $vm.searchText, prompt: "ค้นหาชื่อผู้ขาย หรือเลขผู้เสียภาษี")
            .background(Color.background)
            .task { guard let orgId = authVM.org?.id else { return }; await vm.load(orgId: orgId) }
            .refreshable { guard let orgId = authVM.org?.id else { return }; await vm.load(orgId: orgId) }
            .sheet(item: $editingVendor) { vendor in
                EditVendorSheet(vendor: vendor) { name, taxId, address, phone, category in
                    await vm.update(vendor: vendor, name: name, taxId: taxId, address: address,
                                    phone: phone, category: category)
                }
            }
    }

    // MARK: – Category chips
    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Vendor.categories, id: \.id) { cat in
                    Button {
                        hapticLight()
                        vm.selectedCategory = cat.id
                    } label: {
                        HStack(spacing: 5) {
                            Text(cat.emoji)
                            Text(cat.label)
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(vm.selectedCategory == cat.id ? Color.brand500 : Color.surface)
                        .foregroundColor(vm.selectedCategory == cat.id ? .white : Color.textPrimary)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Color.border, lineWidth: vm.selectedCategory == cat.id ? 0 : 1))
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 8)
    }

    // MARK: – List
    private var list: some View {
        ScrollView {
            VStack(spacing: 0) {
                categoryChips
                LazyVStack(spacing: 10) {
                    ForEach(vm.filtered) { vendor in
                        VendorRow(vendor: vendor) {
                            hapticLight()
                            editingVendor = vendor
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
        }
    }

    private var loadingSkeleton: some View {
        VStack(spacing: 10) {
            ForEach(0..<6, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.border.opacity(0.4))
                    .frame(height: 78)
            }
        }
        .padding(16)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "building.2")
                .font(.system(size: 40))
                .foregroundColor(Color.border)
            Text(vm.searchText.isEmpty ? "ยังไม่มีข้อมูลผู้ขาย" : "ไม่พบผู้ขายที่ค้นหา")
                .font(.system(size: 14))
                .foregroundColor(Color.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: – Row
private struct VendorRow: View {
    let vendor: Vendor
    let onEdit: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(hex: vendor.brandColorHex).opacity(0.16))
                    .frame(width: 46, height: 46)
                Text(vendor.thumbEmoji)
                    .font(.system(size: 20))
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(vendor.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(vendor.categoryEmoji) \(vendor.categoryLabel)")
                    if let count = vendor.docCount {
                        Text("· \(count) เอกสาร")
                    }
                }
                .font(.system(size: 11))
                .foregroundColor(Color.textSecondary)
                .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(fmtTHB(vendor.totalAmount ?? 0))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Color.textPrimary)
                if let last = vendor.lastDocDate {
                    Text(fmtDate(last + "T00:00:00Z"))
                        .font(.system(size: 10))
                        .foregroundColor(Color.textSecondary)
                }
            }

            Button(action: onEdit) {
                Image(systemName: "pencil.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(Color.border)
            }
        }
        .padding(12)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border, lineWidth: 1))
    }
}

// MARK: – Edit Sheet (mirrors web's EditVendorModal)
private struct EditVendorSheet: View {
    let vendor: Vendor
    let onSave: (String, String, String, String, String) async -> Bool
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var taxId: String
    @State private var address: String
    @State private var phone: String
    @State private var category: String
    @State private var saving = false

    init(vendor: Vendor, onSave: @escaping (String, String, String, String, String) async -> Bool) {
        self.vendor = vendor
        self.onSave = onSave
        _name    = State(initialValue: vendor.name)
        _taxId   = State(initialValue: vendor.taxId ?? "")
        _address = State(initialValue: vendor.address ?? "")
        _phone   = State(initialValue: vendor.phone ?? "")
        _category = State(initialValue: vendor.category ?? "other")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("ข้อมูลผู้ขาย") {
                    TextField("ชื่อผู้ขาย", text: $name)
                    TextField("เลขผู้เสียภาษี", text: $taxId)
                        .keyboardType(.numberPad)
                    TextField("ที่อยู่", text: $address)
                    TextField("เบอร์โทร", text: $phone)
                        .keyboardType(.phonePad)
                }
                Section("หมวดหมู่") {
                    Picker("หมวดหมู่", selection: $category) {
                        ForEach(Vendor.categories.filter { $0.id != "all" }, id: \.id) { cat in
                            Text("\(cat.emoji) \(cat.label)").tag(cat.id)
                        }
                    }
                }
            }
            .navigationTitle("แก้ไขผู้ขาย")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ยกเลิก") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        saving = true
                        Task {
                            let ok = await onSave(name, taxId, address, phone, category)
                            saving = false
                            if ok { dismiss() }
                        }
                    } label: {
                        if saving { ProgressView() } else { Text("บันทึก").bold() }
                    }
                    .disabled(saving)
                }
            }
        }
    }
}
