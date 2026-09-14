// ios/Slippy/ViewModels/TripCallViewModel.swift
import Foundation
import LiveKit

/// Voice-only for this plan — never requests or publishes a camera track.
@MainActor
final class TripCallViewModel: ObservableObject {
    @Published var connected = false
    @Published var connecting = false
    @Published var errorText: String?

    private var room: Room?

    deinit {
        let r = room
        Task { await r?.disconnect() }
    }

    func join(tripId: String) async {
        // Guard against re-entrant calls
        guard !connecting && room == nil else { return }

        connecting = true
        defer { connecting = false }
        do {
            let callToken = try await TripCallAPI.requestToken(tripId: tripId)
            let room = Room()
            try await room.connect(url: callToken.url, token: callToken.token)
            self.room = room
            try await room.localParticipant.setMicrophone(enabled: true)
            connected = true
        } catch {
            if let room = self.room {
                await room.disconnect()
                self.room = nil
            }
            errorText = error.localizedDescription
        }
    }

    func leave() async {
        await room?.disconnect()
        room = nil
        connected = false
    }
}
