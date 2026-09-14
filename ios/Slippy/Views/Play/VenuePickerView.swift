import SwiftUI
import MapKit

/// Sheet for picking a sport venue — search via MapKit (biased to Thailand,
/// no API key/location permission needed) or re-pick a saved org favorite.
/// Presented from `CreateSportGroupView`'s venue field.
struct VenuePickerView: View {
    let orgId: String
    let userId: String
    let onPick: (_ name: String, _ mapUrl: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = VenuePickerViewModel()
    @State private var pendingVenue: VenuePickerViewModel.ResolvedVenue?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField

                if let error = vm.error {
                    Text(error).font(.system(size: 12)).foregroundColor(Color.statusFailed)
                        .padding(.horizontal, 16).padding(.top, 8)
                }

                List {
                    if !vm.suggestions.isEmpty {
                        Section("ผลการค้นหา") {
                            ForEach(vm.suggestions, id: \.self) { suggestion in
                                Button {
                                    Task { await pick(suggestion) }
                                } label: {
                                    suggestionRow(suggestion)
                                }
                            }
                        }
                    } else if !vm.favorites.isEmpty {
                        Section("สถานที่ที่บันทึกไว้") {
                            ForEach(vm.favorites) { favorite in
                                Button {
                                    onPick(favorite.name, favorite.mapUrl ?? "")
                                    dismiss()
                                } label: {
                                    favoriteRow(favorite)
                                }
                            }
                            .onDelete { offsets in
                                Task {
                                    for index in offsets { await vm.deleteFavorite(vm.favorites[index]) }
                                }
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .overlay {
                    if vm.suggestions.isEmpty && vm.favorites.isEmpty && !vm.isLoadingFavorites {
                        emptyState
                    }
                }
            }
            .navigationTitle("เลือกสถานที่เล่น")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("ปิด") { dismiss() }.foregroundColor(Color.brand500)
                }
            }
            .task { await vm.loadFavorites(orgId: orgId) }
            .sheet(item: $pendingVenue) { venue in
                saveFavoritePrompt(venue)
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundColor(Color.textSecondary)
            TextField("ค้นหาสนาม/สถานที่", text: $vm.queryText)
                .font(.system(size: 15))
            if vm.isResolving { ProgressView().scaleEffect(0.8) }
        }
        .padding(12)
        .background(Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.border))
        .padding(16)
    }

    private func suggestionRow(_ s: MKLocalSearchCompletion) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(s.title).font(.system(size: 14, weight: .medium)).foregroundColor(Color.textPrimary)
            if !s.subtitle.isEmpty {
                Text(s.subtitle).font(.system(size: 12)).foregroundColor(Color.textSecondary)
            }
        }
    }

    private func favoriteRow(_ f: SportVenueFavorite) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "star.fill").font(.system(size: 13)).foregroundColor(Color(hex: "#f59e0b"))
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name).font(.system(size: 14, weight: .medium)).foregroundColor(Color.textPrimary)
                if let address = f.address {
                    Text(address).font(.system(size: 12)).foregroundColor(Color.textSecondary)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "mappin.and.ellipse").font(.system(size: 32)).foregroundColor(Color.textSecondary.opacity(0.5))
            Text("พิมพ์ค้นหาชื่อสนามหรือสถานที่").font(.system(size: 13)).foregroundColor(Color.textSecondary)
        }
    }

    private func pick(_ suggestion: MKLocalSearchCompletion) async {
        guard let resolved = await vm.resolve(suggestion) else { return }
        pendingVenue = resolved
    }

    private func saveFavoritePrompt(_ venue: VenuePickerViewModel.ResolvedVenue) -> some View {
        VStack(spacing: 18) {
            Spacer().frame(height: 8)
            Image(systemName: "mappin.circle.fill").font(.system(size: 36)).foregroundColor(Color.brand500)
            VStack(spacing: 4) {
                Text(venue.name).font(.system(size: 16, weight: .bold)).foregroundColor(Color.textPrimary)
                if let address = venue.address {
                    Text(address).font(.system(size: 13)).foregroundColor(Color.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
            VStack(spacing: 10) {
                Button {
                    Task { await vm.saveFavorite(orgId: orgId, userId: userId, venue: venue) }
                    onPick(venue.name, venue.mapUrl)
                    pendingVenue = nil
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill")
                        Text("ใช้ + บันทึกเป็นสถานที่ที่ใช้บ่อย")
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 46)
                    .background(Color.brand500)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                Button {
                    onPick(venue.name, venue.mapUrl)
                    pendingVenue = nil
                    dismiss()
                } label: {
                    Text("ใช้ครั้งนี้อย่างเดียว")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color.textSecondary)
                        .frame(maxWidth: .infinity).frame(height: 46)
                }
            }
            .padding(.horizontal, 20)
            Spacer()
        }
        .presentationDetents([.height(280)])
    }
}

extension VenuePickerViewModel.ResolvedVenue: Identifiable {
    var id: String { "\(latitude),\(longitude)" }
}
