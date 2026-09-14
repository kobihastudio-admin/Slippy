import SwiftUI

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * แท็ก + แชร์เอกสาร — attached to a document that already exists.
 * =====================================================================
 * These two features used to live only on the pre-upload review screen, which
 * meant they were reachable for exactly one moment in a document's life: before
 * it had been read, when the user knew least about it. Removing that screen
 * would have removed the features outright, so they moved here, to the detail
 * view, where the document can be tagged and shared at any time.
 *
 * Because the document already exists, every toggle writes immediately —
 * there is no "save" step to batch into, and a tag that silently didn't stick
 * is worse than a brief spinner.
 */
struct DocumentTagsShareSection: View {
    let documentId: String

    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var socialVM = SocialViewModel()

    @State private var availableTags: [DocumentTag] = []
    @State private var selectedTagIds: Set<String> = []
    @State private var newTagName = ""
    @State private var showAddTag = false

    @State private var sharedUserIds: Set<String> = []
    @State private var showFriendPicker = false
    /// Last set committed to the server — lets the picker's sheet dismiss
    /// diff against it instead of re-writing every share row each time.
    @State private var committedShareIds: Set<String> = []

    @State private var isBusy = false

    var body: some View {
        VStack(spacing: 16) {
            tagsCard
            shareCard
        }
        .task {
            guard let orgId = authVM.org?.id else { return }
            await loadAvailableTags(orgId: orgId)
            await loadLinkedTags()
            await loadShares()
            if let userId = authVM.session?.user.id.uuidString {
                await socialVM.load(userId: userId)
            }
        }
    }

    // MARK: – แท็กและป้ายกำกับ

    private var tagsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("แท็กและป้ายกำกับ").font(.system(size: 15, weight: .bold)).foregroundColor(Color.textPrimary)
                Spacer()
                if isBusy { ProgressView().tint(Color.brand500) }
                Button { hapticLight(); showAddTag = true } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                        Text("เพิ่มแท็ก").font(.system(size: 12.5, weight: .semibold))
                    }
                    .foregroundColor(Color.brand500)
                }
            }
            Text("เพิ่มแท็กเพื่อจัดกลุ่มเอกสารให้ค้นหาง่ายขึ้น")
                .font(.system(size: 11.5)).foregroundColor(Color.textSecondary)

            if availableTags.isEmpty {
                Text("ยังไม่มีแท็กในองค์กรนี้ — กด “เพิ่มแท็ก” เพื่อสร้างอันแรก")
                    .font(.system(size: 12))
                    .foregroundColor(Color.textSecondary)
                    .padding(.vertical, 4)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(availableTags) { tag in
                        tagChip(tag)
                    }
                }
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border))
        .alert("เพิ่มแท็กใหม่", isPresented: $showAddTag) {
            TextField("ชื่อแท็ก", text: $newTagName)
            Button("ยกเลิก", role: .cancel) { newTagName = "" }
            Button("เพิ่ม") { Task { await createTag() } }
        }
    }

    private func tagChip(_ tag: DocumentTag) -> some View {
        let isSelected = selectedTagIds.contains(tag.id)
        return Button {
            hapticLight()
            Task { await toggleTag(tag) }
        } label: {
            HStack(spacing: 5) {
                Text("# \(tag.name)").font(.system(size: 12.5, weight: .medium))
                if isSelected {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                }
            }
            .foregroundColor(isSelected ? Color.brand500 : Color.textSecondary)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(isSelected ? Color.brand500.opacity(0.12) : Color.background)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(isSelected ? Color.clear : Color.border, lineWidth: 1))
        }
        .disabled(isBusy)
    }

    // MARK: – แชร์และการเข้าถึง

    private var shareCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("แชร์และการเข้าถึง").font(.system(size: 15, weight: .bold)).foregroundColor(Color.textPrimary)
                    Text("กำหนดสิทธิ์การเข้าถึงเอกสาร").font(.system(size: 11.5)).foregroundColor(Color.textSecondary)
                }
                Spacer()
                Button { hapticLight(); showFriendPicker = true } label: {
                    Text("ดูทั้งหมด").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Color.brand500)
                }
            }

            Button { hapticLight(); showFriendPicker = true } label: {
                HStack(spacing: 12) {
                    HStack(spacing: -8) {
                        ForEach(Array(sharedUserIds.prefix(3)), id: \.self) { fid in
                            if let friend = socialVM.friends.first(where: { $0.id == fid }) {
                                Circle().fill(Color(hex: "#ede9fe")).frame(width: 30, height: 30)
                                    .overlay(Text(friend.displayName.prefix(1).uppercased())
                                        .font(.system(size: 12, weight: .bold)).foregroundColor(Color.brand500))
                                    .overlay(Circle().stroke(Color.surface, lineWidth: 2))
                            }
                        }
                        if sharedUserIds.count > 3 {
                            Circle().fill(Color(hex: "#e5e7eb")).frame(width: 30, height: 30)
                                .overlay(Text("+\(sharedUserIds.count - 3)").font(.system(size: 10, weight: .bold)).foregroundColor(Color.textSecondary))
                                .overlay(Circle().stroke(Color.surface, lineWidth: 2))
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sharedUserIds.isEmpty ? "ยังไม่ได้แชร์" : "แชร์กับเพื่อน \(sharedUserIds.count) คน")
                            .font(.system(size: 13.5, weight: .semibold)).foregroundColor(Color.textPrimary)
                        Text(sharedUserIds.isEmpty ? "แตะเพื่อเลือกเพื่อน" : "สามารถดูและแก้ไขได้")
                            .font(.system(size: 11)).foregroundColor(Color.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 12)).foregroundColor(Color.textSecondary.opacity(0.5))
                }
                .padding(12)
                .background(Color.background)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding(16)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border))
        .sheet(isPresented: $showFriendPicker, onDismiss: {
            Task { await commitShares() }
        }) {
            FriendSharePickerSheet(friends: socialVM.friends, selected: $sharedUserIds)
        }
    }

    // MARK: – Tags I/O

    private func loadAvailableTags(orgId: String) async {
        do {
            availableTags = try await SupabaseManager.shared.client
                .from("document_tags")
                .select("id, organization_id, name")
                .eq("organization_id", value: orgId)
                .order("name")
                .execute()
                .value
        } catch { /* non-critical — tag picker just stays empty */ }
    }

    private func loadLinkedTags() async {
        struct Link: Decodable { let tag_id: String }
        let links: [Link] = (try? await SupabaseManager.shared.client
            .from("document_tag_links")
            .select("tag_id")
            .eq("document_id", value: documentId)
            .execute()
            .value) ?? []
        selectedTagIds = Set(links.map(\.tag_id))
    }

    private func toggleTag(_ tag: DocumentTag) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }

        if selectedTagIds.contains(tag.id) {
            selectedTagIds.remove(tag.id)
            _ = try? await SupabaseManager.shared.client
                .from("document_tag_links").delete()
                .eq("document_id", value: documentId)
                .eq("tag_id", value: tag.id)
                .execute()
        } else {
            selectedTagIds.insert(tag.id)
            struct LinkInsert: Encodable { let document_id: String; let tag_id: String }
            _ = try? await SupabaseManager.shared.client
                .from("document_tag_links")
                .insert(LinkInsert(document_id: documentId, tag_id: tag.id))
                .execute()
        }
    }

    private func createTag() async {
        guard let orgId = authVM.org?.id else { return }
        let name = newTagName.trimmingCharacters(in: .whitespaces)
        newTagName = ""
        guard !name.isEmpty else { return }

        if let existing = availableTags.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            if !selectedTagIds.contains(existing.id) { await toggleTag(existing) }
            return
        }

        struct Insert: Encodable { let organization_id: String; let name: String }
        do {
            let created: [DocumentTag] = try await SupabaseManager.shared.client
                .from("document_tags")
                .insert(Insert(organization_id: orgId, name: name))
                .select("id, organization_id, name")
                .execute()
                .value
            if let tag = created.first {
                availableTags.append(tag)
                await toggleTag(tag)
            }
        } catch {
            // Likely the (organization_id, name) unique constraint — someone
            // else created the same tag name concurrently. Re-fetch and
            // select it instead of just failing silently.
            await loadAvailableTags(orgId: orgId)
            if let existing = availableTags.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }),
               !selectedTagIds.contains(existing.id) {
                await toggleTag(existing)
            }
        }
    }

    // MARK: – Shares I/O

    private func loadShares() async {
        struct Row: Decodable { let shared_with_user_id: String }
        let rows: [Row] = (try? await SupabaseManager.shared.client
            .from("document_shares")
            .select("shared_with_user_id")
            .eq("document_id", value: documentId)
            .execute()
            .value) ?? []
        sharedUserIds    = Set(rows.map(\.shared_with_user_id))
        committedShareIds = sharedUserIds
    }

    /// Writes only the difference. The picker is a multi-select that the user
    /// may open and close repeatedly; re-inserting the whole set each time
    /// would either duplicate rows or need a delete-all first, which briefly
    /// revokes access from people who never lost it.
    private func commitShares() async {
        guard sharedUserIds != committedShareIds,
              let userId = authVM.session?.user.id.uuidString else { return }
        isBusy = true
        defer { isBusy = false }

        let added   = sharedUserIds.subtracting(committedShareIds)
        let removed = committedShareIds.subtracting(sharedUserIds)

        if !added.isEmpty {
            struct ShareInsert: Encodable {
                let document_id: String; let shared_with_user_id: String; let created_by: String
            }
            _ = try? await SupabaseManager.shared.client
                .from("document_shares")
                .insert(added.map {
                    ShareInsert(document_id: documentId, shared_with_user_id: $0, created_by: userId)
                })
                .execute()
        }
        if !removed.isEmpty {
            _ = try? await SupabaseManager.shared.client
                .from("document_shares").delete()
                .eq("document_id", value: documentId)
                .in("shared_with_user_id", values: Array(removed))
                .execute()
        }
        committedShareIds = sharedUserIds
    }
}

// MARK: – Flow layout (wrapping chips — tag pills that don't fit a fixed grid)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth.isFinite ? maxWidth : x, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxWidth = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.minX + maxWidth, x > bounds.minX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: – Multi-select friend picker (document sharing)

struct FriendSharePickerSheet: View {
    let friends: [UserProfile]
    @Binding var selected: Set<String>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(friends) { friend in
                Button {
                    hapticLight()
                    if selected.contains(friend.id) { selected.remove(friend.id) }
                    else { selected.insert(friend.id) }
                } label: {
                    HStack(spacing: 12) {
                        Circle().fill(Color(hex: "#ede9fe")).frame(width: 40, height: 40)
                            .overlay(Text(friend.displayName.prefix(1).uppercased())
                                .font(.system(size: 15, weight: .bold)).foregroundColor(Color.brand500))
                        Text(friend.displayName)
                            .font(.system(size: 14.5))
                            .foregroundColor(Color.textPrimary)
                        Spacer()
                        if selected.contains(friend.id) {
                            Image(systemName: "checkmark.circle.fill").foregroundColor(Color.brand500)
                        } else {
                            Image(systemName: "circle").foregroundColor(Color.textSecondary.opacity(0.4))
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .overlay {
                if friends.isEmpty {
                    Text("ยังไม่มีเพื่อน — เพิ่มเพื่อนก่อนถึงจะแชร์เอกสารได้")
                        .font(.system(size: 13))
                        .foregroundColor(Color.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(32)
                }
            }
            .navigationTitle("แชร์กับเพื่อน")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("เสร็จสิ้น") { dismiss() }
                        .foregroundColor(Color.brand500)
                }
            }
        }
    }
}
