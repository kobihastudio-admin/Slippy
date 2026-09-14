import SwiftUI
import MapKit
import UIKit
import PhotosUI

/// Additive, local-only prototype for the future Trip & Journey module.
/// This view intentionally does not call Supabase or mutate production trip data.
struct JourneyPrototypeView: View {
    private let emerald = Color(hex: "#08783F")
    private let forest = Color(hex: "#064E3B")

    @State private var tab: JourneyTab = .overview
    @State private var sheet: PrototypeSheet?
    @State private var offline = false

    enum JourneyTab: String, CaseIterable, Identifiable {
        case overview = "Overview"
        case plan = "Plan"
        case map = "Map"
        case budget = "Budget"
        case more = "More"

        var id: String { rawValue }
        var icon: String {
            switch self {
            case .overview: return "safari.fill"
            case .plan: return "calendar"
            case .map: return "map.fill"
            case .budget: return "wallet.pass.fill"
            case .more: return "ellipsis"
            }
        }
    }

    enum PrototypeSheet: String, Identifiable {
        case create, stop, expense
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            prototypeBanner
            Group {
                switch tab {
                case .overview: JourneyOverviewView(onPlan: { tab = .plan })
                case .plan: JourneyPlanView(onAddStop: { sheet = .stop })
                case .map: JourneyMapPrototypeView()
                case .budget: JourneyBudgetView(onAddExpense: { sheet = .expense })
                case .more: JourneyMoreView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            tabBar
        }
        .background(Color(hex: "#F7F8F5"))
        .navigationTitle("Slippy Journey")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { offline.toggle() } label: {
                    Image(systemName: offline ? "wifi.slash" : "arrow.triangle.2.circlepath")
                }
                Button { sheet = .create } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(item: $sheet) { item in
            JourneyPrototypeSheet(kind: item)
        }
    }

    private var prototypeBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "hammer.fill")
            Text(offline ? "Prototype · Offline · 2 pending" : "Prototype · Local demo data · No production writes")
                .lineLimit(1)
            Spacer()
        }
        .font(.system(size: 10, weight: .semibold))
        .foregroundColor(forest)
        .padding(.horizontal, 14)
        .frame(height: 30)
        .background(Color(hex: "#D1FAE5"))
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(JourneyTab.allCases) { item in
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { tab = item }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: item.icon)
                            .font(.system(size: 15, weight: .semibold))
                        Text(item.rawValue)
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundColor(tab == item ? emerald : Color.textSecondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 58)
                }
            }
        }
        .background(Color.surface)
        .overlay(alignment: .top) { Divider() }
    }
}

private struct JourneyOverviewView: View {
    let onPlan: () -> Void
    private let emerald = Color(hex: "#08783F")

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                hero
                quickActions
                readiness
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("UP NEXT").font(.system(size: 9, weight: .bold)).tracking(1).foregroundColor(.textSecondary)
                        Text("Day 2 · Kyoto").font(.system(size: 19, weight: .bold)).foregroundColor(.textPrimary)
                    }
                    Spacer()
                    Button("View plan", action: onPlan)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(emerald)
                }
                JourneyMapCard(compact: true)
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Tight connection").font(.system(size: 13, weight: .bold))
                        Text("Gion → lunch has only 6 minutes buffer").font(.system(size: 10)).foregroundColor(.textSecondary)
                    }
                    Spacer()
                }
                .padding(14)
                .background(Color.orange.opacity(0.09))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .padding(16)
            .padding(.bottom, 14)
        }
    }

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [Color(hex: "#082F49"), Color(hex: "#065F46"), Color(hex: "#B45309")], startPoint: .topLeading, endPoint: .bottomTrailing)
            Circle().fill(.white.opacity(0.09)).frame(width: 230).offset(x: 140, y: -85)
            VStack(alignment: .leading, spacing: 6) {
                Text("OFFLINE READY")
                    .font(.system(size: 9, weight: .heavy)).tracking(0.8)
                    .foregroundColor(Color(hex: "#064E3B"))
                    .padding(.horizontal, 9).padding(.vertical, 5)
                    .background(.white.opacity(0.9)).clipShape(Capsule())
                Spacer()
                Text("Japan in Autumn").font(.system(size: 28, weight: .heavy)).foregroundColor(.white)
                Text("12–20 Nov 2025 · 9 Days · Japan").font(.system(size: 11)).foregroundColor(.white.opacity(0.82))
                HStack(spacing: -7) {
                    ForEach(Array(["C", "M", "T", "N"].enumerated()), id: \.offset) { index, name in
                        Text(name).font(.system(size: 10, weight: .bold)).foregroundColor(.white)
                            .frame(width: 30, height: 30)
                            .background([Color.orange, .pink, .blue, .purple][index])
                            .clipShape(Circle()).overlay(Circle().stroke(.white, lineWidth: 2))
                    }
                    Text("+2").font(.system(size: 9, weight: .bold)).foregroundColor(.textPrimary)
                        .frame(width: 30, height: 30).background(.white).clipShape(Circle()).padding(.leading, 12)
                }
                .padding(.top, 5)
            }
            .padding(18)
        }
        .frame(height: 220)
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }

    private var quickActions: some View {
        HStack(spacing: 8) {
            ForEach([("plus", "Add stop"), ("person.badge.plus", "Invite"), ("bahtsign", "Expense"), ("photo", "Photo")], id: \.1) { item in
                VStack(spacing: 6) {
                    Image(systemName: item.0).font(.system(size: 17, weight: .semibold)).foregroundColor(emerald)
                    Text(item.1).font(.system(size: 9, weight: .semibold)).foregroundColor(.textSecondary)
                }
                .frame(maxWidth: .infinity).frame(height: 68)
                .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 15))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color.border))
            }
        }
    }

    private var readiness: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TRIP READINESS").font(.system(size: 9, weight: .bold)).tracking(1).foregroundColor(.textSecondary)
                    Text("72%").font(.system(size: 27, weight: .heavy)).foregroundColor(.textPrimary)
                }
                Spacer()
                Image(systemName: "checkmark.circle.fill").font(.system(size: 32)).foregroundColor(.green)
            }
            ProgressView(value: 0.72).tint(.green)
            HStack { Text("14 / 19 stops planned"); Spacer(); Text("8 / 12 checklist") }
                .font(.system(size: 10)).foregroundColor(.textSecondary)
        }
        .padding(16).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border))
    }
}

private struct JourneyPlanView: View {
    let onAddStop: () -> Void
    @State private var completed: Set<Int> = []
    private let days = [(1, "11 Nov", "Tokyo"), (2, "12 Nov", "Kyoto"), (3, "13 Nov", "Kyoto"), (4, "14 Nov", "Osaka"), (5, "15 Nov", "Nara")]
    private let stops = [
        ("08:30", "Fushimi Inari Taisha", "Explore the iconic torii gates", "18 min · Train", Color.teal),
        ("10:30", "Kiyomizu-dera Temple", "Historic temple with great views", "24 min · Bus", Color.blue),
        ("13:00", "Lunch in Gion", "Try local Kyoto cuisine", "8 min · Walk", Color.orange),
        ("16:00", "Arashiyama Bamboo Grove", "Peaceful walk in nature", "32 min · Train", Color.green)
    ]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(days, id: \.0) { day in
                            VStack(alignment: .leading, spacing: 3) {
                                Text("DAY \(day.0)").font(.system(size: 8, weight: .heavy))
                                Text(day.1).font(.system(size: 13, weight: .bold))
                                Text(day.2).font(.system(size: 9))
                            }
                            .foregroundColor(day.0 == 2 ? Color(hex: "#08783F") : .textSecondary)
                            .padding(11).frame(width: 78, alignment: .leading)
                            .background(day.0 == 2 ? Color(hex: "#ECFDF5") : Color.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 15))
                            .overlay(RoundedRectangle(cornerRadius: 15).stroke(day.0 == 2 ? Color(hex: "#6EE7B7") : Color.border))
                        }
                    }
                }
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Kyoto classics").font(.system(size: 19, weight: .bold))
                        Text("4 stops · 08:30–17:30").font(.system(size: 10)).foregroundColor(.textSecondary)
                    }
                    Spacer()
                    Button(action: onAddStop) { Label("Add Stop", systemImage: "plus") }
                        .font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(Color(hex: "#08783F")).clipShape(RoundedRectangle(cornerRadius: 11))
                }
                VStack(spacing: 0) {
                    ForEach(Array(stops.enumerated()), id: \.offset) { index, stop in
                        HStack(alignment: .top, spacing: 8) {
                            Text(stop.0).font(.system(size: 9, weight: .semibold)).foregroundColor(.textSecondary).frame(width: 42, alignment: .trailing).padding(.top, 7)
                            VStack(spacing: 0) {
                                Button {
                                    if completed.contains(index) { completed.remove(index) } else { completed.insert(index) }
                                } label: {
                                    ZStack {
                                        Circle().fill(completed.contains(index) ? Color.green : stop.4).frame(width: 24, height: 24)
                                        Text(completed.contains(index) ? "✓" : "\(index + 1)").font(.system(size: 8, weight: .heavy)).foregroundColor(.white)
                                    }
                                }
                                if index < stops.count - 1 { Rectangle().fill(Color.border).frame(width: 1, height: 88) }
                            }
                            VStack(alignment: .leading, spacing: 5) {
                                Text(stop.1).font(.system(size: 13, weight: .bold)).strikethrough(completed.contains(index))
                                Text(stop.2).font(.system(size: 10)).foregroundColor(.textSecondary)
                                Divider().padding(.top, 6)
                                HStack { Text("↳ \(stop.3)"); Spacer(); Image(systemName: "chevron.right") }
                                    .font(.system(size: 9)).foregroundColor(.textSecondary)
                            }
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 15))
                            .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color.border))
                        }
                        .opacity(completed.contains(index) ? 0.55 : 1)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                    }
                }
                .padding(.vertical, 5).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.border))
            }
            .padding(16).padding(.bottom, 16)
        }
    }
}

private struct JourneyMapPrototypeView: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            JourneyMapCard(compact: false)
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("DAY 2 ROUTE").font(.system(size: 9, weight: .heavy)).tracking(1).foregroundColor(.textSecondary)
                    Text("Kyoto · 4 stops").font(.system(size: 17, weight: .bold))
                    Text("7.8 km · estimated 1h 12m").font(.system(size: 10)).foregroundColor(.textSecondary)
                }
                Spacer()
                Button("Navigate") { }
                    .font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Color(hex: "#08783F")).clipShape(RoundedRectangle(cornerRadius: 11))
            }
            .padding(16).background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 20))
            .padding(14)
        }
    }
}

private struct JourneyMapCard: View {
    let compact: Bool
    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color(hex: "#DFECE1")
                Capsule().fill(.white.opacity(0.8)).frame(width: geo.size.width * 1.2, height: 26).rotationEffect(.degrees(19)).offset(x: -30, y: -25)
                Capsule().fill(.white.opacity(0.75)).frame(width: 25, height: geo.size.height * 1.2).rotationEffect(.degrees(-28)).offset(x: 40)
                Path { path in
                    path.move(to: CGPoint(x: geo.size.width * 0.22, y: geo.size.height * 0.28))
                    path.addCurve(to: CGPoint(x: geo.size.width * 0.7, y: geo.size.height * 0.72), control1: CGPoint(x: geo.size.width * 0.55, y: geo.size.height * 0.26), control2: CGPoint(x: geo.size.width * 0.42, y: geo.size.height * 0.7))
                }
                .stroke(Color(hex: "#08783F"), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                ForEach(Array([(0.23, 0.28), (0.47, 0.43), (0.7, 0.72)].enumerated()), id: \.offset) { index, point in
                    Text("\(index + 1)").font(.system(size: 9, weight: .heavy)).foregroundColor(.white)
                        .frame(width: 29, height: 29).background(Color(hex: "#08783F")).clipShape(Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 3))
                        .position(x: geo.size.width * point.0, y: geo.size.height * point.1)
                }
            }
        }
        .frame(height: compact ? 220 : nil)
        .clipShape(RoundedRectangle(cornerRadius: compact ? 20 : 0))
    }
}

private struct JourneyBudgetView: View {
    let onAddExpense: () -> Void
    private let categories = [("Accommodation", 0.46, "฿19,620", Color.purple), ("Transport", 0.27, "฿11,440", Color.blue), ("Food", 0.18, "฿7,680", Color.green), ("Activities", 0.09, "฿3,940", Color.orange)]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Spent").font(.system(size: 11)).foregroundColor(.white.opacity(0.7))
                    Text("฿42,680").font(.system(size: 34, weight: .heavy)).foregroundColor(.white)
                    ProgressView(value: 0.53).tint(.yellow)
                    HStack { Text("Budget ฿80,000"); Spacer(); Text("Remaining ฿37,320") }
                        .font(.system(size: 9)).foregroundColor(.white.opacity(0.8))
                }
                .padding(20).background(LinearGradient(colors: [Color(hex: "#064E3B"), Color(hex: "#08783F")], startPoint: .leading, endPoint: .trailing)).clipShape(RoundedRectangle(cornerRadius: 22))
                VStack(spacing: 16) {
                    HStack { Text("Categories").font(.system(size: 17, weight: .bold)); Spacer(); Text("Details").font(.system(size: 11, weight: .bold)).foregroundColor(Color(hex: "#08783F")) }
                    ForEach(categories, id: \.0) { item in
                        VStack(spacing: 7) {
                            HStack { Text(item.0); Spacer(); Text(item.2).fontWeight(.bold) }.font(.system(size: 11))
                            ProgressView(value: item.1).tint(item.3)
                        }
                    }
                }
                .padding(17).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border))
                VStack(spacing: 0) {
                    HStack {
                        VStack(alignment: .leading) { Text("Recent expenses").font(.system(size: 17, weight: .bold)); Text("Original currency + stored rate").font(.system(size: 9)).foregroundColor(.textSecondary) }
                        Spacer()
                        Button("＋ Add", action: onAddExpense).font(.system(size: 11, weight: .bold)).foregroundColor(Color(hex: "#08783F"))
                    }.padding(16)
                    ForEach([("🏨", "Hotel Gracery", "฿18,400"), ("🚆", "Shinkansen", "฿7,920"), ("🍜", "Lunch in Gion", "฿1,340")], id: \.1) { row in
                        Divider().padding(.leading, 16)
                        HStack { Text(row.0).frame(width: 38, height: 38).background(Color.surfaceMuted).clipShape(RoundedRectangle(cornerRadius: 11)); Text(row.1).font(.system(size: 12, weight: .semibold)); Spacer(); Text(row.2).font(.system(size: 12, weight: .bold)) }.padding(12)
                    }
                }
                .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border))
            }
            .padding(16)
        }
    }
}

private struct JourneyMoreView: View {
    @State private var selection: String?
    private let items = [("person.2.wave.2.fill", "Travel together", "LINE · chat · calls · live location"), ("cross.case.fill", "Safety hub", "SOS · hospital · medication · hotel"), ("photo.on.rectangle.angled", "Gallery & media map", "152 photos · 8 unplaced"), ("checklist", "Notes & checklist", "8 / 12 completed"), ("arrow.down.circle.fill", "Offline downloads", "Kyoto ready"), ("gearshape.fill", "Trip settings", "Privacy · currency")]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Memories, collaboration and trip settings").font(.system(size: 11)).foregroundColor(.textSecondary)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(items, id: \.1) { item in
                        Button { selection = item.1 } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Image(systemName: item.0).font(.system(size: 20, weight: .semibold)).foregroundColor(Color(hex: "#08783F"))
                                    .frame(width: 42, height: 42).background(Color(hex: "#ECFDF5")).clipShape(RoundedRectangle(cornerRadius: 13))
                                Text(item.1).font(.system(size: 12, weight: .bold)).foregroundColor(.textPrimary)
                                Text(item.2).font(.system(size: 9)).foregroundColor(.textSecondary)
                            }
                            .frame(maxWidth: .infinity, minHeight: 125, alignment: .leading).padding(14)
                            .background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.border))
                        }
                    }
                }
                HStack(spacing: 10) {
                    Image(systemName: "sparkles").font(.title3).foregroundColor(.orange)
                    VStack(alignment: .leading, spacing: 2) { Text("AI itinerary draft").font(.system(size: 13, weight: .bold)); Text("Preview and select changes before applying").font(.system(size: 10)).foregroundColor(.textSecondary) }
                    Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundColor(.textSecondary)
                }
                .padding(15).background(Color.orange.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 17))
            }
            .padding(16)
        }
        .alert(selection ?? "Prototype", isPresented: Binding(get: { selection != nil }, set: { if !$0 { selection = nil } })) {
            Button("OK") { selection = nil }
        } message: {
            Text(selection == "Travel together" ? "Invite from LINE or Slippy, open group chat or call, and start a visible 60-minute location-sharing session. Every traveler must opt in and can stop immediately." : selection == "Safety hub" ? "Emergency SOS, nearby hospitals, medication card, hotel, insurance, embassy and offline contacts. Health records remain private unless their owner explicitly shares them." : "This prototype screen is ready to connect in the next vertical slice.")
        }
    }
}

private struct JourneyPrototypeSheet: View {
    let kind: JourneyPrototypeView.PrototypeSheet
    @Environment(\.dismiss) private var dismiss
    @State private var tripTitle = "Japan in Autumn"
    @State private var amount = "850"

    private var title: String {
        switch kind { case .create: return "Create New Trip"; case .stop: return "Add Stop"; case .expense: return "Expense Details" }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 15) {
                    switch kind {
                    case .create: createFields
                    case .stop: stopFields
                    case .expense: expenseFields
                    }
                    Button {
                        dismiss()
                    } label: {
                        Text(kind == .create ? "Create Trip" : kind == .stop ? "Add to Itinerary" : "Save Expense")
                            .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(Color(hex: "#08783F")).clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    Text("Prototype only — no production data will be written.")
                        .font(.system(size: 9)).foregroundColor(.textSecondary)
                }
                .padding(18)
            }
            .background(Color.background)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private var createFields: some View {
        Group {
            HStack {
                ForEach(Array(["Basics", "Dates", "Travelers", "Style"].enumerated()), id: \.offset) { index, label in
                    VStack(spacing: 4) { Text("\(index + 1)").font(.system(size: 9, weight: .bold)).foregroundColor(index == 0 ? .white : .textSecondary).frame(width: 25, height: 25).background(index == 0 ? Color(hex: "#08783F") : Color.surfaceMuted).clipShape(Circle()); Text(label).font(.system(size: 8)).foregroundColor(.textSecondary) }.frame(maxWidth: .infinity)
                }
            }
            LinearGradient(colors: [Color(hex: "#082F49"), Color(hex: "#065F46"), Color(hex: "#B45309")], startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: 145).overlay(alignment: .bottomLeading) { VStack(alignment: .leading) { Text("Japan in Autumn").font(.system(size: 21, weight: .bold)); Text("Cover preview").font(.system(size: 9)) }.foregroundColor(.white).padding(15) }.clipShape(RoundedRectangle(cornerRadius: 18))
            prototypeTextField("Trip title", text: $tripTitle)
            prototypeRow("Destination", value: "🇯🇵 Japan")
            HStack { prototypeRow("Start date", value: "12 Nov 2025"); prototypeRow("End date", value: "20 Nov 2025") }
            prototypeRow("Time zone", value: "Asia/Tokyo")
            prototypeRow("Base currency", value: "JPY · Japanese Yen")
        }
    }

    private var stopFields: some View {
        Group {
            prototypeTextField("Search places or activities", text: .constant(""))
            ScrollView(.horizontal, showsIndicators: false) { HStack { ForEach(["Attraction", "Food", "Culture", "Nature", "Shopping"], id: \.self) { Text($0).font(.system(size: 9, weight: .semibold)).padding(.horizontal, 11).padding(.vertical, 8).background(Color.surface).clipShape(Capsule()).overlay(Capsule().stroke(Color.border)) } } }
            ForEach([("Kinkaku-ji Temple", "Kyoto · 4.7 ★"), ("Nishiki Market", "Kyoto · 4.5 ★"), ("Arashiyama Bamboo Grove", "Kyoto · 4.6 ★")], id: \.0) { place in
                HStack { RoundedRectangle(cornerRadius: 10).fill(LinearGradient(colors: [.green.opacity(0.25), .green], startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 52, height: 52); VStack(alignment: .leading) { Text(place.0).font(.system(size: 12, weight: .bold)); Text(place.1).font(.system(size: 9)).foregroundColor(.textSecondary) }; Spacer(); Image(systemName: "plus.circle").foregroundColor(Color(hex: "#08783F")) }.padding(10).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
            }
            HStack { prototypeRow("Day", value: "Day 2"); prototypeRow("Time", value: "15:00") }
        }
    }

    private var expenseFields: some View {
        Group {
            ScrollView(.horizontal, showsIndicators: false) { HStack { ForEach(["Hotel", "Transport", "Food", "Activity"], id: \.self) { Text($0).font(.system(size: 9, weight: .semibold)).foregroundColor($0 == "Food" ? Color(hex: "#08783F") : .textSecondary).padding(.horizontal, 12).padding(.vertical, 8).background($0 == "Food" ? Color(hex: "#ECFDF5") : Color.surface).clipShape(Capsule()).overlay(Capsule().stroke(Color.border)) } } }
            prototypeTextField("Amount (THB)", text: $amount)
            prototypeRow("Description", value: "Lunch at Asakusa")
            prototypeRow("Paid by", value: "Chain")
            prototypeRow("Split method", value: "Equal · 4 people")
            VStack(spacing: 6) { Image(systemName: "camera.fill").font(.title3); Text("Attach receipt").font(.system(size: 10, weight: .semibold)) }.foregroundColor(Color(hex: "#08783F")).frame(maxWidth: .infinity).frame(height: 82).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(Color(hex: "#6EE7B7"), style: StrokeStyle(lineWidth: 1, dash: [5])))
        }
    }

    private func prototypeTextField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.system(size: 9, weight: .bold)).tracking(0.6).foregroundColor(.textSecondary)
            TextField(label, text: text).font(.system(size: 13)).padding(.horizontal, 13).frame(height: 50).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func prototypeRow(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.system(size: 9, weight: .bold)).tracking(0.6).foregroundColor(.textSecondary)
            HStack { Text(value).font(.system(size: 12, weight: .semibold)); Spacer(); Image(systemName: "chevron.right").font(.caption2).foregroundColor(.textSecondary) }.padding(.horizontal, 13).frame(height: 50).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.border))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct JourneyPrototypeView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack { JourneyPrototypeView() }
    }
}

// MARK: - Production journey workspace

/// One workspace for a real `life_journeys` row. Unlike the visual prototype
/// above, every plan/budget/chat action here is backed by the production schema.
struct JourneyWorkspaceView: View {
    let trip: Trip
    @EnvironmentObject private var authVM: AuthViewModel
    @StateObject private var vm = TripsViewModel()
    @StateObject private var messagesVM = MessagesViewModel()
    @StateObject private var socialVM = SocialViewModel()
    @State private var tab = 0
    @State private var showAddDay = false
    @State private var addItemDay: TripItineraryDay?
    @State private var showFriendPicker = false
    @State private var isPreparingShare = false
    @State private var showTravelImport = false
    @State private var showTravelDocuments = false
    @State private var showTripProfileManager = false
    @State private var showKyushuTemplateConfirmation = false
    @State private var applyingKyushuTemplate = false
    @State private var setupError: String?

    var body: some View {
        VStack(spacing: 0) {
            journeyHeader
            journeyTabBar

            Group {
                switch tab {
                case 0: overview
                case 1: itinerary
                case 2: TripRouteMapView(trip: trip, days: vm.itineraryDays)
                case 3: TripDetailView(trip: trip).environmentObject(authVM)
                default: collaboration
                }
            }
        }
        .background(Color(hex: "#080C1A").ignoresSafeArea())
        .preferredColorScheme(.dark)
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .task {
            await vm.loadItinerary(journeyId: trip.id)
            await vm.loadTripConversation(journeyId: trip.id)
        }
        .sheet(isPresented: $showAddDay) { AddItineraryDaySheet { date, title in
            try await vm.addItineraryDay(journeyId: trip.id, date: date, title: title)
        }}
        .sheet(item: $addItemDay) { day in AddItineraryItemSheet(day: day) { type, title, location, time, notes in
            try await vm.addItineraryItem(dayId: day.id, type: type, title: title, location: location, timeFrom: time, notes: notes)
        }}
        .sheet(isPresented: $showFriendPicker) { TripFriendPicker(friends: socialVM.friends) { friend in
            try await vm.addFriendToTrip(journeyId: trip.id, friendId: friend.id)
        }}
        .sheet(isPresented: $showTravelImport) {
            TripImportDocumentSheet(tripId: trip.id) { await vm.loadItinerary(journeyId: trip.id) }
        }
        .sheet(isPresented: $showTravelDocuments) {
            TripDocumentsView(trip: trip)
        }
        .sheet(isPresented: $showTripProfileManager) {
            TripProfileManagerSheet(participants: trip.participants ?? []) { participantId, name, role, emergencyContact, avatarData, sharedWithTrip in
                var avatarURL: String?
                if let avatarData {
                    let photo = try await TripPhotoAPI.upload(
                        journeyId: trip.id, itemId: nil, data: avatarData,
                        caption: "Trip profile avatar"
                    )
                    avatarURL = TripPhotoAPI.publicURL(photo)?.absoluteString
                }
                try await vm.updateTripProfile(
                    participantId: participantId, displayName: name,
                    tripRole: role, emergencyContact: emergencyContact,
                    avatarUrl: avatarURL, profileSharedWithTrip: sharedWithTrip
                )
            }
        }
        .confirmationDialog("ใช้แผน Kyushu 21–28 พ.ย. 2026?", isPresented: $showKyushuTemplateConfirmation) {
            Button("เพิ่มแผน 8 วัน") { Task { await applyKyushuTemplate() } }
            Button("ยกเลิก", role: .cancel) {}
        } message: {
            Text("เพิ่มเฉพาะเมื่อทริปยังไม่มีแผน เพื่อป้องกันรายการซ้ำ รถเช่าเป็นรายการรอตัดสินใจ ไม่ถือว่าจองแล้ว")
        }
        .alert("เตรียมแผนไม่สำเร็จ", isPresented: .constant(setupError != nil)) {
            Button("ตกลง") { setupError = nil }
        } message: { Text(setupError ?? "") }
    }

    private var journeyHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.brand300)
                .frame(width: 34, height: 34)
                .background(Color.brand600.opacity(0.55), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.title).font(.system(size: 20, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Text([trip.destination, "\(vm.itineraryDays.count) วัน"].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11)).foregroundColor(Color(hex: "#94A3B8"))
            }
            Spacer()
            HStack(spacing: -7) {
                JourneyAvatar(url: authVM.profile?.avatarUrl, initials: authVM.profile?.initials ?? "ฉ", tint: .brand500)
                ForEach(Array((trip.participants ?? []).prefix(3).enumerated()), id: \.offset) { index, member in
                    JourneyAvatar(url: nil, initials: String(member.displayName.prefix(1)), tint: [Color.statusProcessing, .statusApproved, .statusPushed][index])
                }
            }
            Button { showTripProfileManager = true } label: {
                Image(systemName: "person.crop.circle.badge.pencil")
                    .font(.system(size: 18, weight: .medium)).foregroundColor(.brand300)
                    .padding(.leading, 5)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(Color(hex: "#0E1527"))
    }

    private var journeyTabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                journeyTab("ภาพรวม", icon: "sparkles", index: 0)
                journeyTab("แผน", icon: "calendar", index: 1)
                journeyTab("แผนที่", icon: "map", index: 2)
                journeyTab("ค่าใช้จ่าย", icon: "wallet.pass", index: 3)
                journeyTab("ทีม", icon: "person.2", index: 4)
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
        }
        .background(Color(hex: "#0B1120"))
    }

    private func journeyTab(_ title: String, icon: String, index: Int) -> some View {
        Button { withAnimation(.easeInOut(duration: 0.2)) { tab = index } } label: {
            Label(title, systemImage: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(tab == index ? .white : Color(hex: "#9CA9C4"))
                .padding(.horizontal, 13).padding(.vertical, 9)
                .background(tab == index ? Color.brand500 : Color(hex: "#151D32"), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var overview: some View {
        ScrollView {
            VStack(spacing: 14) {
                journeyHero
                nextKyushuMoment
                journeyManagementCenter
                kyushuTravelCrew
                travelIdentityTags

                HStack(spacing: 10) {
                    workspaceStat("วัน", "\(vm.itineraryDays.count)", "calendar")
                    workspaceStat("ผู้ร่วม", "\(trip.participants?.count ?? 0)", "person.2")
                    workspaceStat("ค่าใช้จ่าย", fmtTHB(trip.computedTotal), "wallet.pass")
                }
                kyushuGallery
                travelCommandCenter
                Button { tab = 1 } label: {
                    Label(vm.itineraryDays.isEmpty ? "เริ่มวางแผนรายวัน" : "เปิดแผนการเดินทาง", systemImage: "arrow.right.circle.fill")
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(14).background(LinearGradient(colors: [.brand500, .brand600], startPoint: .leading, endPoint: .trailing))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }.padding(16)
        }
    }

    private var journeyHero: some View {
        ZStack(alignment: .bottomLeading) {
            Image("KyushuTripCover")
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, minHeight: 250, maxHeight: 250)
                .clipped()
            LinearGradient(
                colors: [Color(hex: "#071126").opacity(0.96), Color(hex: "#111C46").opacity(0.72), .clear],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(colors: [.clear, Color(hex: "#081126").opacity(0.93)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 10) {
                Text("KYUSHU ANIME JOURNEY · 2026").font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundColor(Color(hex: "#DAD5FF"))
                Text(trip.tripTypeEmoji + " " + trip.title).font(.system(size: 26, weight: .bold)).foregroundColor(.white).shadow(color: Color.black.opacity(0.7), radius: 3, x: 0, y: 1).lineLimit(2)
                if let destination = trip.destination ?? trip.venue { Label(destination, systemImage: "mappin.and.ellipse") }
                if let start = trip.startedAt ?? trip.eventDate {
                    Label([start.prefix(10), trip.endedAt?.prefix(10)].compactMap { $0.map(String.init) }.joined(separator: " – "), systemImage: "calendar")
                }
                HStack(spacing: -7) {
                    JourneyAvatar(url: authVM.profile?.avatarUrl, initials: authVM.profile?.initials ?? "ฉ", tint: .brand900)
                    ForEach(Array((trip.participants ?? []).prefix(3).enumerated()), id: \.offset) { index, member in
                        JourneyAvatar(url: nil, initials: String(member.displayName.prefix(1)), tint: [Color.statusProcessing, .statusApproved, .statusPushed][index])
                    }
                    Text("  \(trip.participants?.count ?? 1) ผู้ร่วมเดินทาง").font(.system(size: 11, weight: .semibold)).foregroundColor(.brand100)
                }
            }
            .font(.system(size: 13)).foregroundColor(.brand100)
            .padding(19).frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 250)
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.brand300.opacity(0.45), lineWidth: 1))
    }

    private var kyushuGallery: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Kyushu visual diary", systemImage: "photo.stack.fill")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Text("Anime gallery")
                    .font(.system(size: 11, weight: .semibold)).foregroundColor(.brand300)
            }
            Text("เก็บบรรยากาศแต่ละช่วงของทริปไว้เป็นแรงบันดาลใจ ก่อนเพิ่มภาพจริงของทีม")
                .font(.system(size: 11)).foregroundColor(.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    KyushuMomentCard(imageName: "KyushuFukuoka", title: "Fukuoka at night", subtitle: "Canal City · yatai lights", accent: .brand400)
                    KyushuMomentCard(imageName: "KyushuKumamoto", title: "Kumamoto & Aso", subtitle: "Castle · one-piece route", accent: .statusProcessing)
                    KyushuMomentCard(imageName: "KyushuYufuin", title: "Yufuin morning", subtitle: "Lake · ryokan · mist", accent: .statusApproved)
                    KyushuMomentCard(imageName: "KyushuShrine", title: "Temple day", subtitle: "Maple · shrine · calm", accent: .statusPushed)
                }
            }
        }
        .padding(15).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var kyushuTravelCrew: some View {
        let sharedProfiles = (trip.participants ?? []).filter(\.profileSharedWithTrip)
        return VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("Kyushu travel crew", systemImage: "person.3.sequence.fill")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Text("Nov 2026").font(.system(size: 11, weight: .semibold)).foregroundColor(.brand300)
            }
            HStack(spacing: 8) {
                KyushuCrewBadge(imageName: "KyushuDrTom", name: "Dr. Tom", role: "Mentor")
                KyushuCrewBadge(imageName: "KyushuDrJoey", name: "Dr. Joey", role: "Navigator")
                KyushuCrewBadge(imageName: "KyushuNancy", name: "Nancy", role: "Planner")
                KyushuCrewBadge(imageName: "KyushuVivi", name: "Vivi", role: "Story")
            }
            if !sharedProfiles.isEmpty {
                Divider().overlay(Color(hex: "#27324D"))
                Text("Profile ที่สมาชิกเลือกแชร์")
                    .font(.system(size: 10, weight: .semibold)).foregroundColor(.brand300)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 9) {
                        ForEach(sharedProfiles) { member in
                            SharedTripProfileBadge(member: member)
                        }
                    }
                }
            }
        }
        .padding(14).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var travelIdentityTags: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("Travel identity tags", systemImage: "tag.fill")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Text("พร้อมติดกระเป๋า").font(.system(size: 11, weight: .semibold)).foregroundColor(.brand300)
            }
            Text("บัตรสัมภาระเฉพาะตัวของทีม · กดดูเพื่อเก็บเป็นความทรงจำของทริป")
                .font(.system(size: 11)).foregroundColor(.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    KyushuMascotIdentityTag(imageName: "KyushuMascotTom", name: "Dr. Tom", animal: "Shiba Inu")
                    KyushuMascotIdentityTag(imageName: "KyushuMascotJoey", name: "Dr. Joey", animal: "Wise Owl")
                    KyushuMascotIdentityTag(imageName: "KyushuMascotNancy", name: "Nancy", animal: "Red Panda")
                    KyushuMascotIdentityTag(imageName: "KyushuMascotVivi", name: "Vivi", animal: "Lucky Rabbit")
                }
            }
        }
        .padding(14).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var nextKyushuMoment: some View {
        let day = vm.itineraryDays.first
        let title = day?.title ?? "เริ่มสร้างตอนแรกของการเดินทาง"
        let detail = day?.items?.first?.title ?? "เพิ่มจุดหมายแรก แล้ว Slippy จะรวมแผน เอกสาร และการนำทางไว้ให้"

        return HStack(spacing: 13) {
            ZStack {
                Image("KyushuShrine")
                    .resizable().scaledToFill()
                    .frame(width: 82, height: 96).clipped()
                LinearGradient(colors: [.clear, Color(hex: "#071126").opacity(0.65)], startPoint: .top, endPoint: .bottom)
                Image(systemName: "sparkle.magnifyingglass")
                    .font(.system(size: 20, weight: .bold)).foregroundColor(.white)
            }
            .clipShape(RoundedRectangle(cornerRadius: 15))

            VStack(alignment: .leading, spacing: 5) {
                Text("NEXT KYUSHU MOMENT")
                    .font(.system(size: 10, weight: .bold)).tracking(0.9).foregroundColor(.brand300)
                Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Text(detail).font(.system(size: 11)).foregroundColor(Color(hex: "#B8C2D9")).lineLimit(2)
            }
            Spacer(minLength: 0)
            Button { tab = 1 } label: {
                Image(systemName: "arrow.right")
                    .font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                    .frame(width: 31, height: 31).background(Color.brand500, in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 19))
        .overlay(RoundedRectangle(cornerRadius: 19).stroke(Color.brand500.opacity(0.36), lineWidth: 1))
    }

    private var journeyManagementCenter: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Label("จัดการทริป", systemImage: "slider.horizontal.3")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Text("ทุกอย่างในที่เดียว")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.brand300)
            }
            Text("เปิดส่วนที่ต้องจัดการได้ทันที โดยยังคงบรรยากาศทริป Kyushu ไว้ในหน้าเดียว")
                .font(.system(size: 11)).foregroundColor(.textSecondary)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 9), count: 2), spacing: 9) {
                Button { tab = 1 } label: {
                    JourneyManagementAction(title: "แผน 8 วัน", detail: "ตาราง · จุดหมาย", icon: "calendar", tint: .brand500)
                }
                .buttonStyle(.plain)
                Button { showTravelDocuments = true } label: {
                    JourneyManagementAction(title: "Travel Wallet", detail: "พาสปอร์ต · ใบจอง", icon: "folder.fill", tint: .statusApproved)
                }
                .buttonStyle(.plain)
                Button { tab = 3 } label: {
                    JourneyManagementAction(title: "ค่าใช้จ่าย", detail: "แยกจ่าย · สรุป", icon: "wallet.pass.fill", tint: .statusProcessing)
                }
                .buttonStyle(.plain)
                Button { tab = 4 } label: {
                    JourneyManagementAction(title: "ทีมและแท็ก", detail: "สมาชิก · สัมภาระ", icon: "person.3.fill", tint: .statusPushed)
                }
                .buttonStyle(.plain)
                Button { showTripProfileManager = true } label: {
                    JourneyManagementAction(title: "Profile ทริป", detail: "รูป · บทบาท · ติดต่อ", icon: "person.crop.circle.badge.pencil", tint: .brand400)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    /// One operational home for the things travellers otherwise lose between
    /// email, a rental-car site and several map apps. The document reader
    /// keeps a human review step before writing any booking into the plan.
    private var travelCommandCenter: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Travel Command Center", systemImage: "suitcase.rolling.fill")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                if applyingKyushuTemplate { ProgressView().controlSize(.small) }
            }
            Text("เอกสารสำคัญ แผนที่ และรายการพร้อมเดินทางอยู่ในทริปเดียว")
                .font(.system(size: 12)).foregroundColor(.textSecondary)

            HStack(spacing: 10) {
                Button { showTravelImport = true } label: {
                    commandAction("สแกนเอกสาร", "ตั๋ว · โรงแรม · รถเช่า", "doc.text.viewfinder")
                }.buttonStyle(.plain)
                Button { showTravelDocuments = true } label: {
                    commandAction("Travel Wallet", "พาสปอร์ต · ประกัน", "folder.fill")
                }.buttonStyle(.plain)
            }

            HStack(spacing: 10) {
                Button { tab = 2 } label: {
                    commandAction("แผนที่ & นำทาง", "Apple Maps · Google Maps", "map.fill")
                }.buttonStyle(.plain)
                Button { showKyushuTemplateConfirmation = true } label: {
                    commandAction("ใช้แผน Kyushu", "21–28 พ.ย. · 8 วัน", "calendar.badge.plus")
                }
                .buttonStyle(.plain)
                .disabled(!vm.itineraryDays.isEmpty || applyingKyushuTemplate)
            }

            Label("รถเช่า 23–25 พ.ย. ยังเป็นรอตัดสินใจ: ยืนยันจุดรับรถ/คืนรถและจำนวนผู้โดยสารก่อนกดจอง", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color(hex: "#9A3412"))
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: "#FFF7ED"), in: RoundedRectangle(cornerRadius: 11))
        }
        .padding(15).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func commandAction(_ title: String, _ subtitle: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: icon).font(.system(size: 17, weight: .semibold)).foregroundColor(.brand300)
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundColor(.textPrimary)
            Text(subtitle).font(.system(size: 10)).foregroundColor(.textSecondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(11)
        .background(Color(hex: "#171E33"), in: RoundedRectangle(cornerRadius: 13))
    }

    private struct KyushuDay {
        let date: String; let title: String; let city: String
        let items: [(type: String, title: String, location: String, time: String?, notes: String?)]
    }

    /// The latest user-supplied outline. It is deliberately a one-tap template
    /// rather than a hidden seed: dates, hotels and the final rental booking
    /// remain visible and editable decisions owned by the traveller.
    private static let kyushuTemplate: [KyushuDay] = [
        .init(date: "2026-11-21", title: "Fukuoka old town & Nakasu", city: "Fukuoka", items: [
            ("activity", "Kushida Shrine", "Kushida Shrine, Fukuoka", nil, nil),
            ("shopping", "Canal City Hakata", "Canal City Hakata", nil, nil),
            ("meal", "Nakasu evening", "Nakasu, Fukuoka", nil, "เลือกร้านและจองโต๊ะถ้าจำเป็น")]),
        .init(date: "2026-11-22", title: "Fukuoka autumn", city: "Fukuoka", items: [
            ("activity", "Yusentei Park", "Yusentei Park, Fukuoka", nil, nil),
            ("activity", "Ohori Park", "Ohori Park, Fukuoka", nil, nil),
            ("activity", "Fukuoka Castle", "Fukuoka Castle Ruins", nil, "ตรวจช่วงใบไม้แดง"),
            ("shopping", "Tenjin", "Tenjin, Fukuoka", nil, nil)]),
        .init(date: "2026-11-23", title: "Kumamoto & One Piece", city: "Kumamoto", items: [
            ("shinkansen", "Hakata → Kumamoto", "Hakata Station", "07:30", "ยืนยันตั๋วและเวลาขบวน"),
            ("car_rental", "รับรถเช่า (รอตัดสินใจ)", "Kumamoto Station Shinkansen Exit", "09:00", "เปรียบเทียบ Nippon 7 ที่นั่ง กับ Nissan 8 ที่นั่ง; ตรวจใบขับขี่สากล, ETC และประกัน"),
            ("activity", "Kumamoto Castle", "Kumamoto Castle", nil, nil),
            ("activity", "One Piece statues", "Kumamoto Prefectural Government Office", nil, "Luffy เป็นจุดหลัก; Chopper/Zoro/Usopp/Franky เป็น optional ตามเวลา")]),
        .init(date: "2026-11-24", title: "Dazaifu → Yufuin", city: "Yufuin", items: [
            ("activity", "Dazaifu Tenmangu", "Dazaifu Tenmangu", nil, nil),
            ("activity", "Kamado Shrine", "Kamado Shrine, Dazaifu", nil, "ตรวจเวลาเปิดและการเดินขึ้น"),
            ("hotel", "พัก Yufuin", "Yufuin, Oita", nil, "เพิ่มใบยืนยันโรงแรม")]),
        .init(date: "2026-11-25", title: "Yufuin → Fukuoka", city: "Fukuoka", items: [
            ("activity", "Kirin Lake", "Kinrinko Lake, Yufuin", nil, nil),
            ("activity", "Yunotsubo Street", "Yunotsubo Kaido, Yufuin", nil, nil),
            ("shopping", "Yufuin Floral Village", "Yufuin Floral Village", nil, nil),
            ("car_rental", "คืนรถเช่า", "Kumamoto Station Shinkansen Exit", nil, "ยืนยันสาขาคืนรถจริงและค่าน้ำมัน")]),
        .init(date: "2026-11-26", title: "Temple day", city: "Fukuoka", items: [
            ("train", "Nanzoin Temple", "Nanzoin Temple", nil, nil),
            ("activity", "Kaizan Sennyuji", "Kaizan Sennyuji, Fukuoka", nil, nil),
            ("shopping", "Hakata", "Hakata Station", nil, nil)]),
        .init(date: "2026-11-27", title: "Hakata & Tenjin", city: "Fukuoka", items: [
            ("activity", "Tochoji Temple", "Tochoji Temple", nil, nil),
            ("shopping", "Tenjin Underground Mall", "Tenjin Chikagai", nil, nil),
            ("shopping", "Canal City final shopping", "Canal City Hakata", nil, "จัด tax-free และแพ็กกระเป๋า")]),
        .init(date: "2026-11-28", title: "Departure", city: "Fukuoka", items: [
            ("flight", "เดินทางไป Fukuoka Airport", "Fukuoka Airport", nil, "เพิ่มเที่ยวบิน เช็กอิน และคืน SIM/Wi‑Fi")])
    ]

    @MainActor
    private func applyKyushuTemplate() async {
        guard vm.itineraryDays.isEmpty else { return }
        applyingKyushuTemplate = true
        defer { applyingKyushuTemplate = false }
        do {
            for source in Self.kyushuTemplate {
                try await vm.addItineraryDay(journeyId: trip.id, date: source.date, title: source.title)
                guard let day = vm.itineraryDays.last else { throw TemplateError.dayCreation }
                for item in source.items {
                    try await vm.addItineraryItem(dayId: day.id, type: item.type, title: item.title,
                                                  location: item.location, timeFrom: item.time, notes: item.notes)
                }
            }
            await vm.loadItinerary(journeyId: trip.id)
            hapticSuccess()
            tab = 1
        } catch { setupError = error.localizedDescription }
    }

    private enum TemplateError: LocalizedError { case dayCreation
        var errorDescription: String? { "สร้างวันในแผนไม่สำเร็จ" }
    }

    private func workspaceStat(_ label: String, _ value: String, _ icon: String) -> some View {
        VStack(spacing: 6) { Image(systemName: icon).foregroundColor(.brand400); Text(value).font(.system(size: 14, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7); Text(label).font(.system(size: 10)).foregroundColor(Color(hex: "#94A3B8")) }
            .frame(maxWidth: .infinity).padding(.vertical, 14).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var itinerary: some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack { Text("แผนรายวัน").font(.system(size: 18, weight: .bold)); Spacer(); Button { showAddDay = true } label: { Label("เพิ่มวัน", systemImage: "plus") } }
                if vm.itineraryDays.isEmpty {
                    ContentUnavailableView("ยังไม่มีแผน", systemImage: "calendar.badge.plus", description: Text("เพิ่มวันแรก แล้วบันทึกสถานที่ อาหาร โรงแรม หรือการเดินทาง"))
                        .frame(minHeight: 300)
                } else {
                    ForEach(vm.itineraryDays) { day in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack { VStack(alignment: .leading) { Text("วันที่ \(day.dayNumber)").font(.headline); Text(day.title ?? day.date ?? "ยังไม่ระบุ").font(.caption).foregroundColor(.textSecondary) }; Spacer(); Button { addItemDay = day } label: { Image(systemName: "plus.circle.fill").font(.title3) } }
                            ForEach(day.items ?? []) { item in
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: itineraryIcon(item.type)).foregroundColor(Color(hex: "#08783F")).frame(width: 22)
                                    VStack(alignment: .leading, spacing: 3) { Text(item.title).font(.system(size: 14, weight: .semibold)); HStack { if let time = item.timeFrom { Text(String(time.prefix(5))) }; if let location = item.location { Text(location) } }.font(.caption).foregroundColor(.textSecondary) }
                                    Spacer()
                                    Button(role: .destructive) { Task { try? await vm.removeItineraryItem(item.id, journeyId: trip.id) } } label: { Image(systemName: "trash") }
                                }.padding(10).background(Color.background).clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                        }.padding(14).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                }
            }.padding(16)
        }
    }

    private var collaboration: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let conversationId = vm.tripConversationId, let userId = authVM.session?.user.id.uuidString {
                    NavigationLink { FriendChatRoomView(vm: messagesVM, conversationId: conversationId, currentUserId: userId).navigationTitle(trip.title) } label: {
                        workspaceAction("แชทกลุ่มทริป", "ข้อความและการอัปเดตของสมาชิก", "message.fill")
                    }.buttonStyle(.plain)
                } else { workspaceAction("กำลังเตรียมห้องแชท", "ดึงลงเพื่อโหลดอีกครั้ง", "message.badge") }
                NavigationLink { TripDetailView(trip: trip).environmentObject(authVM) } label: { workspaceAction("สมาชิกและการหารค่าใช้จ่าย", "เพิ่มผู้ร่วมทริปและเคลียร์ยอด", "person.2.fill") }.buttonStyle(.plain)
                Button { showFriendPicker = true; if let uid = authVM.session?.user.id.uuidString { Task { await socialVM.load(userId: uid) } } } label: { workspaceAction("เพิ่มเพื่อน Slippy", "เลือกจากรายชื่อเพื่อนที่ยืนยันแล้ว", "person.badge.plus") }.buttonStyle(.plain)
                Button { Task { await shareTripViaLine() } } label: {
                    workspaceAction("เชิญผ่าน LINE", isPreparingShare ? "กำลังเตรียมลิงก์…" : "ส่ง LIFF ปัจจุบันให้เพื่อนหรือกลุ่ม LINE", "link")
                }.buttonStyle(.plain).disabled(isPreparingShare)
                workspaceAction("แชร์ตำแหน่งชั่วคราว", "จะเปิดใช้เมื่อมี consent และ retention policy", "location.fill")
                workspaceAction("Safety Hub และโทรในแอป", "ต้องเชื่อม Maps, emergency directory และ VoIP provider", "cross.case.fill")
            }.padding(16)
        }.refreshable { await vm.loadTripConversation(journeyId: trip.id) }
    }

    private func workspaceAction(_ title: String, _ subtitle: String, _ icon: String) -> some View {
        HStack(spacing: 12) { Image(systemName: icon).foregroundColor(Color(hex: "#08783F")).frame(width: 40, height: 40).background(Color(hex: "#ECFDF5")).clipShape(RoundedRectangle(cornerRadius: 12)); VStack(alignment: .leading) { Text(title).font(.system(size: 14, weight: .semibold)); Text(subtitle).font(.system(size: 11)).foregroundColor(.textSecondary) }; Spacer(); Image(systemName: "chevron.right").foregroundColor(.textSecondary) }
            .padding(14).background(Color.surface).clipShape(RoundedRectangle(cornerRadius: 15))
    }

    private func itineraryIcon(_ type: String) -> String {
        switch type { case "meal": return "fork.knife"; case "transport": return "tram.fill"; case "hotel": return "bed.double.fill"; case "booking": return "ticket.fill"; default: return "mappin.circle.fill" }
    }

    @MainActor
    private func shareTripViaLine() async {
        isPreparingShare = true
        defer { isPreparingShare = false }
        let token: String
        do {
            if let existingToken = trip.shareToken {
                token = existingToken
            } else {
                token = try await vm.ensureShareToken(journeyId: trip.id)
            }
        } catch {
            vm.error = error.localizedDescription
            return
        }
        guard let url = Config.tripLiffURL(shareToken: token) else { return }
        let destination = trip.destination ?? trip.venue ?? "ทริปของเรา"
        let text = "✈️ ชวนเข้าร่วม \(trip.title) · \(destination)\nเปิดใน LINE เพื่อเข้าร่วมและดูค่าใช้จ่าย: \(url.absoluteString)"
        let controller = UIActivityViewController(activityItems: [text, url], applicationActivities: nil)
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
        var presenter = root
        while let shown = presenter.presentedViewController { presenter = shown }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 40, width: 1, height: 1)
        }
        presenter.present(controller, animated: true)
    }
}

/// Compact, native avatar used in the Journey header and hero. It uses the
/// profile image when available and falls back to a stable initial badge, so a
/// missing upload never leaves an empty participant slot.
private struct JourneyAvatar: View {
    let url: String?
    let initials: String
    let tint: Color

    var body: some View {
        ZStack {
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { fallback }
                }
            } else { fallback }
        }
        .frame(width: 31, height: 31)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color(hex: "#0E1527"), lineWidth: 2))
    }

    private var fallback: some View {
        Text(initials.uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(tint)
    }
}

/// A reusable visual-diary tile. Generated travel mood images stay separate
/// from a traveller's private uploads in the real photo gallery.
private struct KyushuMomentCard: View {
    let imageName: String
    let title: String
    let subtitle: String
    let accent: Color

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Image(imageName)
                .resizable()
                .scaledToFill()
                .frame(width: 208, height: 142)
                .clipped()
            LinearGradient(colors: [.clear, Color(hex: "#071126").opacity(0.92)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                Text(subtitle).font(.system(size: 10, weight: .medium)).foregroundColor(.white.opacity(0.82))
            }
            .padding(12)
        }
        .frame(width: 208, height: 142)
        .clipShape(RoundedRectangle(cornerRadius: 15))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(accent.opacity(0.75), lineWidth: 1))
    }
}

private struct KyushuCrewBadge: View {
    let imageName: String
    let name: String
    let role: String

    var body: some View {
        VStack(spacing: 3) {
            Image(imageName)
                .resizable()
                .scaledToFill()
                .frame(width: 68, height: 68, alignment: .top)
                .clipped()
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.brand300.opacity(0.65), lineWidth: 1.5))
                .frame(maxWidth: .infinity)
            Text(name).font(.system(size: 10, weight: .bold)).foregroundColor(.white).lineLimit(1)
            Text(role).font(.system(size: 8, weight: .medium)).foregroundColor(Color(hex: "#94A3B8")).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct KyushuMascotIdentityTag: View {
    let imageName: String
    let name: String
    let animal: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Image(imageName)
                .resizable()
                .scaledToFit()
                .frame(width: 104, height: 104)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 13))
                .background(Color(hex: "#181F3A"), in: RoundedRectangle(cornerRadius: 13))
            Text(name).font(.system(size: 11, weight: .bold)).foregroundColor(.white)
            Text(animal).font(.system(size: 9, weight: .medium)).foregroundColor(.brand300)
        }
        .padding(9)
        .frame(width: 122, alignment: .leading)
        .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct SharedTripProfileBadge: View {
    let member: TripParticipant

    var body: some View {
        HStack(spacing: 7) {
            TripProfileAvatar(url: member.avatarUrl, initials: String(member.displayName.prefix(1)))
                .scaleEffect(0.65)
                .frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(member.displayName).font(.system(size: 10, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Text(member.tripRole?.nilIfBlank ?? "Traveller").font(.system(size: 8)).foregroundColor(Color(hex: "#9CA9C4")).lineLimit(1)
            }
        }
        .padding(7)
        .background(Color(hex: "#171E33"), in: RoundedRectangle(cornerRadius: 11))
    }
}

private struct JourneyManagementAction: View {
    let title: String
    let detail: String
    let icon: String
    let tint: Color

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(tint)
                .frame(width: 31, height: 31)
                .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Text(detail).font(.system(size: 9, weight: .medium)).foregroundColor(Color(hex: "#9CA9C4")).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 13))
    }
}

/// Keeps the traveller's journey-facing identity distinct from their account
/// profile. A photo is uploaded to the trip gallery so all active members can
/// see the avatar that was chosen for this specific trip.
private struct TripProfileManagerSheet: View {
    let participants: [TripParticipant]
    let save: (String, String, String?, String?, Data?, Bool) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var editing: TripParticipant?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("รูป บทบาท และข้อมูลติดต่อฉุกเฉินในหน้านี้ใช้เฉพาะทริปนี้ ไม่เปลี่ยนโปรไฟล์บัญชีหลัก")
                        .font(.footnote).foregroundColor(.secondary)
                }
                Section("สมาชิกในทริป") {
                    if participants.isEmpty {
                        ContentUnavailableView("ยังไม่มีสมาชิก", systemImage: "person.2.slash", description: Text("เพิ่มสมาชิกในแท็บทีมก่อน แล้วจึงกำหนด Profile สำหรับทริป"))
                    } else {
                        ForEach(participants) { member in
                            Button { editing = member } label: {
                                HStack(spacing: 12) {
                                    TripProfileAvatar(url: member.avatarUrl, initials: String(member.displayName.prefix(1)))
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(member.displayName).foregroundColor(.primary)
                                        Text(member.profileSharedWithTrip ? (member.tripRole?.isEmpty == false ? member.tripRole! : (member.isHost ? "Host" : "Traveller")) : "Profile ส่วนตัว")
                                            .font(.caption).foregroundColor(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Profile ทริป")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("เสร็จ") { dismiss() } } }
            .sheet(item: $editing) { member in
                TripProfileEditorSheet(member: member, save: save)
            }
        }
    }
}

private struct TripProfileEditorSheet: View {
    let member: TripParticipant
    let save: (String, String, String?, String?, Data?, Bool) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var role: String
    @State private var emergencyContact: String
    @State private var pickedImage: PhotosPickerItem?
    @State private var preview: UIImage?
    @State private var imageData: Data?
    @State private var sharedWithTrip: Bool
    @State private var saving = false
    @State private var errorText: String?

    init(member: TripParticipant, save: @escaping (String, String, String?, String?, Data?, Bool) async throws -> Void) {
        self.member = member
        self.save = save
        _name = State(initialValue: member.displayName)
        _role = State(initialValue: member.tripRole ?? (member.isHost ? "Host" : "Traveller"))
        _emergencyContact = State(initialValue: member.emergencyContact ?? "")
        _sharedWithTrip = State(initialValue: member.profileSharedWithTrip)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("รูปในทริป") {
                    HStack {
                        Spacer()
                        PhotosPicker(selection: $pickedImage, matching: .images) {
                            ZStack(alignment: .bottomTrailing) {
                                if let preview {
                                    Image(uiImage: preview).resizable().scaledToFill()
                                } else {
                                    TripProfileAvatar(url: member.avatarUrl, initials: String(name.prefix(1)))
                                }
                                Image(systemName: "camera.fill")
                                    .font(.caption.weight(.bold)).foregroundColor(.white)
                                    .frame(width: 28, height: 28).background(Color.brand500, in: Circle())
                            }
                            .frame(width: 92, height: 92)
                            .clipShape(Circle())
                        }
                        Spacer()
                    }
                    Text("เลือกภาพใหม่เพื่อใช้เป็น Avatar เฉพาะใน Journey นี้")
                        .font(.caption).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .center)
                }
                Section("ข้อมูลในทริป") {
                    TextField("ชื่อที่แสดง", text: $name)
                    TextField("บทบาท เช่น Navigator", text: $role)
                    TextField("ผู้ติดต่อฉุกเฉิน", text: $emergencyContact)
                        .textContentType(.telephoneNumber)
                }
                Section("การแชร์กับทีม") {
                    Toggle("แชร์ Avatar และบทบาทให้ทีม", isOn: $sharedWithTrip)
                    Text("หากปิดไว้ ข้อมูลนี้จะแสดงเฉพาะเจ้าของ Profile ในมุมมองทริป")
                        .font(.caption).foregroundColor(.secondary)
                }
                if let errorText { Section { Text(errorText).foregroundColor(.red) } }
            }
            .navigationTitle("แก้ไข Profile")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "กำลังบันทึก…" : "บันทึก") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do {
                                try await save(member.id, name.trimmingCharacters(in: .whitespacesAndNewlines),
                                               role.nilIfBlank, emergencyContact.nilIfBlank, imageData, sharedWithTrip)
                                dismiss()
                            } catch { errorText = error.localizedDescription }
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                }
            }
            .onChange(of: pickedImage) { _, item in
                Task {
                    guard let source = try? await item?.loadTransferable(type: Data.self),
                          let image = UIImage(data: source) else { return }
                    preview = image
                    imageData = image.jpegData(compressionQuality: 0.78)
                }
            }
        }
    }
}

private struct TripProfileAvatar: View {
    let url: String?
    let initials: String

    var body: some View {
        Group {
            if let url, let remote = URL(string: url) {
                AsyncImage(url: remote) { image in image.resizable().scaledToFill() } placeholder: { avatarFallback }
            } else { avatarFallback }
        }
        .frame(width: 46, height: 46).clipShape(Circle())
    }

    private var avatarFallback: some View {
        Text(initials.uppercased()).font(.system(size: 16, weight: .bold)).foregroundColor(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.brand600)
    }
}

private extension String {
    var nilIfBlank: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

private struct AddItineraryDaySheet: View {
    let save: (String?, String?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date(); @State private var title = ""; @State private var saving = false
    var body: some View { NavigationStack { Form { DatePicker("วันที่", selection: $date, displayedComponents: .date); TextField("ชื่อวัน เช่น Kyoto", text: $title); Button(saving ? "กำลังบันทึก…" : "เพิ่มวัน") { saving = true; Task { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; try? await save(f.string(from: date), title.isEmpty ? nil : title); dismiss() } }.disabled(saving) }.navigationTitle("เพิ่มวัน").toolbar { Button("ยกเลิก") { dismiss() } } } }
}

private struct AddItineraryItemSheet: View {
    let day: TripItineraryDay; let save: (String, String, String?, String?, String?) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var type = "activity"; @State private var title = ""; @State private var location = ""; @State private var time = Date(); @State private var notes = ""; @State private var saving = false
    var body: some View { NavigationStack { Form { Picker("ประเภท", selection: $type) { ForEach(["activity", "meal", "transport", "hotel", "booking", "other"], id: \.self) { Text($0).tag($0) } }; TextField("ชื่อรายการ", text: $title); TextField("สถานที่", text: $location); DatePicker("เวลา", selection: $time, displayedComponents: .hourAndMinute); TextField("หมายเหตุ", text: $notes, axis: .vertical); Button(saving ? "กำลังบันทึก…" : "เพิ่มในแผน") { saving = true; Task { let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; try? await save(type, title, location.isEmpty ? nil : location, f.string(from: time), notes.isEmpty ? nil : notes); dismiss() } }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || saving) }.navigationTitle("วันที่ \(day.dayNumber)").toolbar { Button("ยกเลิก") { dismiss() } } } }
}

private struct TripFriendPicker: View {
    let friends: [UserProfile]; let add: (UserProfile) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busyId: String?
    var body: some View { NavigationStack { List {
        if friends.isEmpty { ContentUnavailableView("ยังไม่มีเพื่อน", systemImage: "person.2.slash", description: Text("เพิ่มและยืนยันเพื่อนจากหน้าโซเชียลก่อน")) }
        ForEach(friends) { friend in Button { busyId = friend.id; Task { try? await add(friend); dismiss() } } label: { HStack { Text(friend.displayName); Spacer(); if busyId == friend.id { ProgressView() } else { Image(systemName: "plus.circle.fill") } } }.disabled(busyId != nil) }
    }.navigationTitle("เพิ่มเพื่อนเข้าทริป").toolbar { Button("ปิด") { dismiss() } } } }
}

private struct TripMapPin: Identifiable {
    let id = UUID(); let title: String; let subtitle: String; let coordinate: CLLocationCoordinate2D
}

/// Resolves itinerary place names through MapKit and displays real Apple Maps.
/// No location permission is requested because this maps planned places, not the user.
private struct TripRouteMapView: View {
    let trip: Trip; let days: [TripItineraryDay]
    @State private var pins: [TripMapPin] = []
    @State private var position: MapCameraPosition = .automatic
    @State private var loading = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Map(position: $position) {
                ForEach(pins) { pin in Marker(pin.title, systemImage: "mappin.circle.fill", coordinate: pin.coordinate).tint(Color(hex: "#08783F")) }
            }.mapControls { MapCompass(); MapScaleView(); MapPitchToggle() }
            if loading { ProgressView("กำลังค้นหาสถานที่…").padding(12).background(.ultraThinMaterial).clipShape(Capsule()) }
            else if pins.isEmpty {
                ContentUnavailableView("ยังไม่มีตำแหน่งบนแผนที่", systemImage: "map", description: Text("เพิ่มชื่อสถานที่ในแผนรายวันก่อน"))
                    .padding().background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 18)).padding()
            } else {
                HStack {
                    VStack(alignment: .leading) {
                        Text("\(pins.count) สถานที่").font(.headline)
                        Text("เลือก Apple Maps หรือ Google Maps สำหรับนำทาง").font(.caption).foregroundColor(.textSecondary)
                    }
                    Spacer()
                    Menu {
                        Button("Apple Maps") { openFirstPin() }
                        Button("Google Maps") { openFirstPinInGoogleMaps() }
                    } label: {
                        Label("นำทาง", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                    }
                }
                    .padding(14).background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 16)).padding()
            }
        }.task(id: days.flatMap { $0.items ?? [] }.map(\.location).description) { await resolvePins() }
    }

    private func resolvePins() async {
        let located = days.flatMap { day in (day.items ?? []).compactMap { item -> (String, String)? in
            guard let place = item.location?.trimmingCharacters(in: .whitespacesAndNewlines), !place.isEmpty else { return nil }
            return (item.title, place + (trip.destination.map { ", \($0)" } ?? ""))
        }}
        loading = true; defer { loading = false }
        var output: [TripMapPin] = []
        for entry in located.prefix(20) {
            let request = MKLocalSearch.Request(); request.naturalLanguageQuery = entry.1
            if let mapItem = try? await MKLocalSearch(request: request).start().mapItems.first {
                output.append(TripMapPin(title: entry.0, subtitle: entry.1, coordinate: mapItem.placemark.coordinate))
            }
        }
        pins = output; if !output.isEmpty { position = .automatic }
    }

    private func openFirstPin() {
        guard let pin = pins.first else { return }
        MKMapItem(placemark: MKPlacemark(coordinate: pin.coordinate)).openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }

    private func openFirstPinInGoogleMaps() {
        guard let pin = pins.first else { return }
        // A universal Maps URL hands off to the Google Maps app when installed,
        // but keeps a safe browser fallback for travellers without it.
        GoogleMapsLinks.open(GoogleMapsLinks.directionsURL(
            destination: (pin.coordinate.latitude, pin.coordinate.longitude), mode: .driving))
    }
}
