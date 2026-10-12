import SwiftUI
import MapKit
import UIKit
import PhotosUI
import Supabase

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
    @Environment(\.dismiss) private var dismiss
    @State private var tab = 0
    /// Tabs visited before the current one, oldest first. Back walks this
    /// stack one step at a time and only leaves the trip from the overview.
    @State private var tabHistory: [Int] = []
    @State private var steppingBack = false
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
    @State private var metadata: [String: AnyJSON] = [:]
    @State private var tripPhotos: [TripPhoto] = []
    @State private var livePeople: [TripParticipant]?
    @State private var showCover = false
    @State private var showGallery = false
    @State private var momentRequest: MomentRequest?
    @State private var selectedCrew: KyushuCrew?
    @State private var selectedTag: KyushuCrew?
    @State private var pager: PagerRequest?

    /// Participants as last fetched; falls back to what the trip list loaded.
    private var people: [TripParticipant] { livePeople ?? trip.participants ?? [] }

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

            // MainTabView draws its floating bar over the content area (it
            // ignores the bottom safe area), so without this the last cards of
            // every tab here sat underneath the bar.
            Color.clear.frame(height: FloatingTabBar.clearance)
        }
        .background(Color(hex: "#080C1A").ignoresSafeArea())
        .preferredColorScheme(.dark)
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        // On the overview the system back button leaves the trip as usual. On
        // any other tab it is replaced by one that steps back to the tab the
        // user came from (the swipe-back edge gesture is off while it is hidden).
        .navigationBarBackButtonHidden(!tabHistory.isEmpty)
        .toolbar {
            if !tabHistory.isEmpty {
                ToolbarItem(placement: .topBarLeading) {
                    Button { stepBack() } label: {
                        Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold))
                    }
                    .accessibilityLabel("ย้อนกลับ")
                }
            }
        }
        .onChange(of: tab) { old, new in
            if steppingBack { steppingBack = false; return }
            guard old != new else { return }
            // Returning to the tab we just left counts as going back, not forward.
            if tabHistory.last == new { tabHistory.removeLast() }
            else { tabHistory.append(old) }
        }
        .task {
            await vm.loadItinerary(journeyId: trip.id)
            await vm.loadTripConversation(journeyId: trip.id)
            await loadExtras()
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
            TripProfileManagerSheet(participants: people, save: saveTripProfile)
        }
        .sheet(isPresented: $showGallery, onDismiss: { Task { await loadExtras() } }) {
            TripGalleryView(trip: trip, days: vm.itineraryDays)
        }
        .fullScreenCover(isPresented: $showCover) {
            CoverViewerSheet(url: coverURL, onPick: changeCover, onReset: resetCover)
        }
        .sheet(item: $momentRequest) { request in
            MomentDetailSheet(request: request, onOpenPlan: { momentRequest = nil; tab = 1 })
        }
        .sheet(item: $selectedCrew) { crew in
            CrewProfileSheet(crew: crew, participant: participant(for: crew), avatarURL: visibleAvatarURL(participant(for: crew)), save: saveTripProfile)
        }
        .sheet(item: $selectedTag) { crew in
            IdentityTagSheet(crew: crew, state: tagState(crew),
                             save: { name, animal, data in try await saveTag(crew, name: name, animal: animal, imageData: data) },
                             reset: { try await resetTag(crew) })
        }
        .fullScreenCover(item: $pager) { request in
            TripImagePager(items: request.items, start: request.start)
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

    // MARK: – Trip page data (cover, gallery, identity tags, profiles)

    private var coverURL: URL? {
        metadata["cover_path"]?.stringValue.flatMap { TripPhotoAPI.publicURL(path: $0) }
    }

    /// Real photos only — the cover, profile avatars and tag pictures are stored
    /// in the same table and must not show up as "trip photos".
    private var galleryPhotos: [TripPhoto] {
        tripPhotos.filter { photo in
            let caption = photo.caption ?? ""
            return caption != "Trip cover" && caption != "Trip profile avatar" && !caption.hasPrefix("Trip identity tag")
        }
    }

    private func loadExtras() async {
        if let loaded = try? await TripMetadataAPI.load(journeyId: trip.id) { metadata = loaded }
        if let photos = try? await TripPhotoAPI.list(journeyId: trip.id) { tripPhotos = photos }
    }

    @MainActor
    private func changeCover(_ data: Data) async throws {
        let photo = try await TripPhotoAPI.upload(journeyId: trip.id, itemId: nil, data: data, caption: "Trip cover")
        try await TripMetadataAPI.set(journeyId: trip.id, key: "cover_path", value: .string(photo.storagePath))
        metadata["cover_path"] = .string(photo.storagePath)
        hapticSuccess()
    }

    @MainActor
    private func resetCover() async throws {
        try await TripMetadataAPI.set(journeyId: trip.id, key: "cover_path", value: nil)
        metadata["cover_path"] = nil
    }

    /// Matches a crew card to a trip participant: exact display name first
    /// (covers short Thai nicknames such as "วิ"), then a substring match for
    /// longer aliases.
    private func participant(for crew: KyushuCrew) -> TripParticipant? {
        let names = people.map { ($0, $0.displayName.trimmingCharacters(in: .whitespaces).lowercased()) }
        if let exact = names.first(where: { pair in crew.aliases.contains(pair.1) }) { return exact.0 }
        return names.first(where: { pair in crew.aliases.contains { $0.count >= 3 && pair.1.contains($0) } })?.0
    }

    @MainActor
    private func saveTripProfile(participantId: String, name: String, role: String?, emergencyContact: String?,
                                 avatarData: Data?, sharedWithTrip: Bool) async throws {
        var avatarURL: String?
        if let avatarData {
            let photo = try await TripPhotoAPI.upload(
                journeyId: trip.id, itemId: nil, data: avatarData, caption: "Trip profile avatar"
            )
            avatarURL = TripPhotoAPI.publicURL(photo)?.absoluteString
        }
        try await vm.updateTripProfile(
            participantId: participantId, displayName: name,
            tripRole: role, emergencyContact: emergencyContact,
            avatarUrl: avatarURL, profileSharedWithTrip: sharedWithTrip
        )
        if let rows = try? await TripPeopleAPI.fetch(journeyId: trip.id) { livePeople = rows }
    }

    /// A member's photo is shown when they chose to share it with the trip, to
    /// the member themselves, and to the host for members who have no account.
    private func visibleAvatarURL(_ member: TripParticipant?) -> URL? {
        guard let member, let raw = member.avatarUrl, let url = URL(string: raw) else { return nil }
        let me = authVM.session?.user.id.uuidString.lowercased()
        let iAmHost = people.contains { $0.isHost && $0.userId?.lowercased() == me }
        if member.profileSharedWithTrip || member.userId?.lowercased() == me || (member.userId == nil && iAmHost) { return url }
        return nil
    }

    private func tagState(_ crew: KyushuCrew) -> IdentityTagState {
        let entry = metadata["identity_tags"]?.objectValue?[crew.id]?.objectValue
        return IdentityTagState(
            name: entry?["name"]?.stringValue ?? crew.name,
            animal: entry?["animal"]?.stringValue ?? crew.animal,
            imageURL: entry?["image_path"]?.stringValue.flatMap { TripPhotoAPI.publicURL(path: $0) },
            isCustomImage: entry?["image_path"]?.stringValue != nil
        )
    }

    @MainActor
    private func saveTag(_ crew: KyushuCrew, name: String, animal: String, imageData: Data?) async throws {
        var tags = metadata["identity_tags"]?.objectValue ?? [:]
        var entry = tags[crew.id]?.objectValue ?? [:]
        entry["name"] = .string(name)
        entry["animal"] = .string(animal)
        if let imageData {
            let photo = try await TripPhotoAPI.upload(journeyId: trip.id, itemId: nil, data: imageData, caption: "Trip identity tag")
            entry["image_path"] = .string(photo.storagePath)
        }
        tags[crew.id] = .object(entry)
        try await TripMetadataAPI.set(journeyId: trip.id, key: "identity_tags", value: .object(tags))
        metadata["identity_tags"] = .object(tags)
        hapticSuccess()
    }

    @MainActor
    private func resetTag(_ crew: KyushuCrew) async throws {
        var tags = metadata["identity_tags"]?.objectValue ?? [:]
        tags.removeValue(forKey: crew.id)
        try await TripMetadataAPI.set(journeyId: trip.id, key: "identity_tags", value: tags.isEmpty ? nil : .object(tags))
        metadata["identity_tags"] = tags.isEmpty ? nil : .object(tags)
    }

    /// The day the "next moment" card describes: the first day that has not
    /// passed yet, else the first day of the plan.
    private var upcomingDay: TripItineraryDay? {
        let today = ISO8601DateFormatter.string(from: Date(), timeZone: .current,
                                                formatOptions: [.withFullDate, .withDashSeparatorInDate])
        return vm.itineraryDays.first(where: { ($0.date ?? "") >= today }) ?? vm.itineraryDays.first
    }

    private func stepBack() {
        guard let previous = tabHistory.popLast() else { dismiss(); return }
        guard previous != tab else { return }
        steppingBack = true
        withAnimation(.easeInOut(duration: 0.2)) { tab = previous }
    }

    private var journeyHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.brand300)
                .frame(width: 34, height: 34)
                .background(Color.brand600.opacity(0.55), in: Circle())
                .onTapGesture { showCover = true }
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.title).font(.system(size: 20, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Text([trip.destination, "\(vm.itineraryDays.count) วัน"].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11)).foregroundColor(Color(hex: "#94A3B8"))
            }
            .contentShape(Rectangle())
            .onTapGesture { showCover = true }   // view the full background, or change it
            Spacer()
            HStack(spacing: -7) {
                JourneyAvatar(url: authVM.profile?.avatarUrl, initials: authVM.profile?.initials ?? "ฉ", tint: .brand500, name: authVM.profile?.displayName)
                ForEach(Array(people.prefix(3).enumerated()), id: \.offset) { index, member in
                    JourneyAvatar(url: member.profileSharedWithTrip ? member.avatarUrl : nil, initials: String(member.displayName.prefix(1)), tint: [Color.statusProcessing, .statusApproved, .statusPushed][index], name: member.displayName)
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
                    workspaceStat("ผู้ร่วม", "\(people.count)", "person.2")
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
        // This page is drawn on fixed dark cards. Resolve adaptive colours (and
        // default text) as dark here so a light system appearance cannot turn
        // section titles black on the dark background.
        .environment(\.colorScheme, .dark)
    }

    private var journeyHero: some View {
        ZStack(alignment: .bottomLeading) {
            // The cover is 16:9 and `scaledToFill` at 250pt tall wants ~444pt of
            // width. As the layout child of this ZStack that made the hero — and
            // so every card in the overview's VStack — wider than the screen, so
            // both edges ran off it. As an overlay on a flexible clear base the
            // image is only drawn, never measured, so the hero takes the width
            // it is offered and the picture is cropped to it.
            Color.clear
                .overlay(heroImage)
                .clipped()
            LinearGradient(
                colors: [Color(hex: "#071126").opacity(0.96), Color(hex: "#111C46").opacity(0.72), .clear],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(colors: [.clear, Color(hex: "#081126").opacity(0.93)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 10) {
                Text("KYUSHU AUTUMN ESCAPE · 2026").font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundColor(Color(hex: "#DAD5FF"))
                Text(trip.tripTypeEmoji + " " + trip.title).font(.system(size: 26, weight: .bold)).foregroundColor(.white).shadow(color: Color.black.opacity(0.7), radius: 3, x: 0, y: 1).lineLimit(2)
                if let destination = trip.destination ?? trip.venue { Label(destination, systemImage: "mappin.and.ellipse") }
                if let start = trip.startedAt ?? trip.eventDate {
                    Label([start.prefix(10), trip.endedAt?.prefix(10)].compactMap { $0.map(String.init) }.joined(separator: " – "), systemImage: "calendar")
                }
                HStack(spacing: -7) {
                    JourneyAvatar(url: authVM.profile?.avatarUrl, initials: authVM.profile?.initials ?? "ฉ", tint: .brand900, name: authVM.profile?.displayName)
                    ForEach(Array(people.prefix(3).enumerated()), id: \.offset) { index, member in
                        JourneyAvatar(url: member.profileSharedWithTrip ? member.avatarUrl : nil, initials: String(member.displayName.prefix(1)), tint: [Color.statusProcessing, .statusApproved, .statusPushed][index], name: member.displayName)
                    }
                    Text("  \(people.count) ผู้ร่วมเดินทาง").font(.system(size: 11, weight: .semibold)).foregroundColor(.brand100)
                }
            }
            .font(.system(size: 13)).foregroundColor(.brand100)
            .padding(19).frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: 250)
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.brand300.opacity(0.45), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            Image(systemName: "photo.badge.plus")
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                .frame(width: 32, height: 32).background(.black.opacity(0.38), in: Circle())
                .padding(12)
        }
        .contentShape(RoundedRectangle(cornerRadius: 22))
        .onTapGesture { showCover = true }
    }

    /// The custom cover when one was chosen, else the bundled Kyushu cover.
    @ViewBuilder private var heroImage: some View {
        if let coverURL {
            AsyncImage(url: coverURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { Image("KyushuTripCover").resizable().scaledToFill() }
            }
        } else {
            Image("KyushuTripCover").resizable().scaledToFill()
        }
    }

    private static let animeMoments: [(name: String, title: String, subtitle: String)] = [
        ("KyushuFukuoka", "Fukuoka at night", "Canal City · yatai lights"),
        ("KyushuKumamoto", "Kumamoto & Aso", "Castle · one-piece route"),
        ("KyushuYufuin", "Yufuin morning", "Lake · ryokan · mist"),
        ("KyushuShrine", "Temple day", "Maple · shrine · calm"),
    ]

    /// The team's own photos first, then the mood images.
    private var galleryItems: [PagerItem] {
        let real: [PagerItem] = galleryPhotos.compactMap { photo in
            TripPhotoAPI.publicURL(photo).map { PagerItem.remote(url: $0, title: photo.caption) }
        }
        return real + Self.animeMoments.map { PagerItem.asset(name: $0.name, title: $0.title, subtitle: $0.subtitle) }
    }

    private var kyushuGallery: some View {
        let items = galleryItems
        let accents: [Color] = [.brand400, .statusProcessing, .statusApproved, .statusPushed]
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Kyushu visual diary", systemImage: "photo.stack.fill")
                    .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                Spacer()
                Button { showGallery = true } label: {
                    Label("แกลเลอรี · เพิ่มรูป", systemImage: "plus.circle.fill")
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(.brand300)
                }
                .buttonStyle(.plain)
            }
            Text("เก็บบรรยากาศแต่ละช่วงของทริปไว้เป็นแรงบันดาลใจ ก่อนเพิ่มภาพจริงของทีม · แตะเพื่อดูและปัดเพื่อเลื่อน")
                .font(.system(size: 11)).foregroundColor(.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        KyushuMomentCard(item: item, accent: accents[index % accents.count])
                            .onTapGesture { pager = PagerRequest(items: items, start: index) }
                    }
                }
            }
        }
        .padding(15).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func sharedAvatarURL(_ crew: KyushuCrew) -> URL? {
        visibleAvatarURL(participant(for: crew))
    }

    private var kyushuTravelCrew: some View {
        let sharedProfiles = people.filter(\.profileSharedWithTrip)
        return VStack(alignment: .leading, spacing: 9) {
            HStack {
                Label("Kyushu travel crew", systemImage: "person.3.sequence.fill")
                    .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                Spacer()
                Text("Nov 2026").font(.system(size: 11, weight: .semibold)).foregroundColor(.brand300)
            }
            Text("แตะรูปเพื่อดู Profile ดูรูปใหญ่ เปลี่ยนรูป และแก้ไขข้อมูล")
                .font(.system(size: 11)).foregroundColor(.textSecondary)
            HStack(spacing: 8) {
                ForEach(kyushuCrew) { crew in
                    KyushuCrewBadge(crew: crew, avatarURL: sharedAvatarURL(crew))
                        .contentShape(Rectangle())
                        .onTapGesture { selectedCrew = crew }
                }
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
                    .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                Spacer()
                Text("พร้อมติดกระเป๋า").font(.system(size: 11, weight: .semibold)).foregroundColor(.brand300)
            }
            Text("บัตรสัมภาระเฉพาะตัวของทีม · แตะเพื่อดูรูปใหญ่และแก้ไขชื่อ สัตว์ประจำตัว หรือรูป")
                .font(.system(size: 11)).foregroundColor(.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(kyushuCrew) { crew in
                        let state = tagState(crew)
                        KyushuMascotIdentityTag(imageName: crew.mascotImage, imageURL: state.imageURL,
                                                name: state.name, animal: state.animal)
                            .onTapGesture { selectedTag = crew }
                    }
                }
            }
        }
        .padding(14).background(Color(hex: "#0E1527")).clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var nextKyushuMoment: some View {
        let day = upcomingDay
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
            .onTapGesture { momentRequest = MomentRequest(day: day, imageName: "KyushuShrine") }

            VStack(alignment: .leading, spacing: 5) {
                Text("NEXT KYUSHU MOMENT")
                    .font(.system(size: 10, weight: .bold)).tracking(0.9).foregroundColor(.brand300)
                Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(.white).lineLimit(1)
                Text(detail).font(.system(size: 11)).foregroundColor(Color(hex: "#B8C2D9")).lineLimit(2)
            }
            .contentShape(Rectangle())
            .onTapGesture { momentRequest = MomentRequest(day: day, imageName: "KyushuShrine") }
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
                    .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
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
                    .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
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

            Label("รถเช่า AVIS จองและจ่ายแล้ว (23 พ.ย. Kumamoto · 24–26 พ.ย. Hakata) — พก IDP ตัวจริงทุกคนที่ขับ · ที่พัก Yufuin ยังไม่จ่าย ยกเลิกฟรีถึง 20 พ.ย.", systemImage: "exclamationmark.triangle.fill")
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
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
            Text(subtitle).font(.system(size: 10)).foregroundColor(.textSecondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(11)
        .background(Color(hex: "#171E33"), in: RoundedRectangle(cornerRadius: 13))
    }

    private struct KyushuDay {
        let date: String; let title: String; let city: String
        let items: [(type: String, title: String, location: String, time: String?, notes: String?)]
    }

    /// Snapshot of the confirmed Notion master itinerary, last reconciled on
    /// 18 September 2026. It stays a one-tap template so travellers can review
    /// confirmed bookings and optional stops before writing them to the trip.
    private static let kyushuTemplate: [KyushuDay] = [
        .init(date: "2026-11-21", title: "Fukuoka old town & Nakasu", city: "Fukuoka", items: [
            ("hotel", "JR Kyushu Hotel Blossom Fukuoka", "2-2-4 Hakataeki Higashi, Hakata-ku", nil, "Superior Double ×2 ห้อง · 4 คน · Pay at hotel · สมาชิกคนที่ 5 ต้องยืนยันที่พักแยก"),
            ("activity", "Kushida Shrine", "Kushida Shrine, Fukuoka", nil, nil),
            ("activity", "Hakata old town", "Hakata, Fukuoka", nil, nil),
            ("shopping", "Canal City Hakata", "Canal City Hakata", nil, "ดูรองเท้า"),
            ("meal", "Nakasu evening", "Nakasu, Fukuoka", nil, "เลือกร้านและจองโต๊ะถ้าจำเป็น")]),
        .init(date: "2026-11-22", title: "Fukuoka autumn", city: "Fukuoka", items: [
            ("activity", "Yusentei Park", "Yusentei Park, Fukuoka", "09:00", nil),
            ("activity", "Ohori Park", "Ohori Park, Fukuoka", nil, nil),
            ("activity", "Fukuoka Castle", "Fukuoka Castle Ruins", nil, "ตรวจช่วงใบไม้แดง"),
            ("shopping", "Tenjin", "Tenjin, Fukuoka", nil, nil)]),
        .init(date: "2026-11-23", title: "Kumamoto day trip & One Piece", city: "Kumamoto", items: [
            ("shinkansen", "Sakura 401 · Hakata → Kumamoto", "Hakata Station", "07:58", "ถึง 08:36 · ตั๋วซื้อแล้ว 5 คน"),
            ("car_rental", "AVIS Kumamoto Station · #00010850016", "3-13-6 Kasuga, Nishi-ku, Kumamoto", "09:00", "WA Wagon · คืน 17:00 · Safety Pack/NOC ¥0 · จ่ายแล้ว ¥15,472 · พก Passport + IDP Geneva 1949 ตัวจริง + บัตรเครดิต"),
            ("activity", "Kumamoto Castle + Josaien", "Kumamoto Castle", "09:30", "เผื่อประมาณ 3 ชั่วโมง"),
            ("activity", "Luffy Statue", "Kumamoto Prefectural Office", nil, nil),
            ("activity", "Suizenji Jojuen + lunch", "Suizenji Jojuen Garden, Kumamoto", nil, nil),
            ("activity", "Chopper Statue", "Kumamoto City Zoological and Botanical Gardens", nil, nil),
            ("activity", "Zoro Statue · optional", "Ozu Central Park, Kumamoto", nil, "ใช้เวลาเพิ่มประมาณ 85 นาทีไป-กลับ; ตัดออกถ้าเวลาเริ่มตึง"),
            ("car_rental", "คืนรถ AVIS Kumamoto Station", "AVIS Kumamoto Station", "17:00", "พักและอาหารเย็นที่ Amu Plaza Kumamoto"),
            ("shinkansen", "Sakura 772 · Kumamoto → Hakata", "Kumamoto Station", "19:38", "ถึง Hakata 20:16 · ตั๋วซื้อแล้ว")]),
        .init(date: "2026-11-24", title: "Dazaifu → Yufuin", city: "Yufuin", items: [
            ("car_rental", "AVIS Hakata Station Chikushi Exit · #00010859204", "1-18-10 Hakataeki Higashi, Hakata-ku", "09:00", "WA Wagon · คืน 26 พ.ย. 19:00 · Safety Pack + ETC · จ่ายแล้ว ¥51,711"),
            ("activity", "Dazaifu Tenmangu", "Dazaifu Tenmangu", "09:45", "จอด Dazaifu Parking Center · ชิม Umegae Mochi"),
            ("activity", "Kamado Shrine", "Kamado Shrine, Dazaifu", "11:30", "ต่อทางด่วนไป Yufuin"),
            ("activity", "Kinrin Lake", "Kinrinko Lake, Yufuin", nil, "แวะเมื่อถึง Yufuin หากเวลาพอ"),
            ("hotel", "Yufuin Bath Satoyamasafu", "828-1 Kawaminami, Yufuin-cho, Yufu", "16:30", "Confirmation #6307849636 · 5 คน · รวมอาหารเช้า/เย็น · เช็กอินก่อน 18:00 · จอดรถฟรี")]),
        .init(date: "2026-11-25", title: "Yufuin → Fukuoka", city: "Fukuoka", items: [
            ("hotel", "เช็กเอาต์ Satoyamasafu", "Yufuin Bath Satoyamasafu", "08:30", "เช็กเอาต์ได้ 08:00–10:00"),
            ("activity", "Kinrin Lake morning", "Kinrinko Lake, Yufuin", "09:00", nil),
            ("activity", "Yunotsubo Street", "Yunotsubo Kaido, Yufuin", nil, nil),
            ("shopping", "Yufuin Floral Village", "Yufuin Floral Village", nil, "ไม่มีที่จอดของตัวเอง ใช้ coin parking ใกล้เคียง"),
            ("car_rental", "ขับกลับ Fukuoka", "Yufuin, Oita", "13:15", "ไม่แวะ Dazaifu ซ้ำ · เก็บรถไว้ใช้ถึง 26 พ.ย."),
            ("hotel", "JR Kyushu Hotel Blossom Fukuoka", "2-2-4 Hakataeki Higashi, Hakata-ku", nil, "พัก 25–27 พ.ย. · Superior Double ×2 ห้อง · Pay at hotel")]),
        .init(date: "2026-11-26", title: "Temple day", city: "Fukuoka", items: [
            ("activity", "Nanzoin Temple", "Nanzoin Temple, Sasaguri", nil, "ใช้รถเช่า · จอดฝั่งเหนือสถานี Sasaguri"),
            ("activity", "Tennoin / Nomiyama · recommended", "Nomiyama Kannonji Temple", nil, "ตัวเลือกใกล้ Nanzoin ประมาณ 20 นาที"),
            ("activity", "Raizan Sennyoji · optional", "Raizan Sennyoji Daihioin", nil, "เลือกแทน Tennoin หากเวลาเหลือ; ไกลประมาณ 60 นาที"),
            ("car_rental", "คืนรถ AVIS Hakata Station Chikushi Exit", "1-18-10 Hakataeki Higashi, Hakata-ku", "19:00", "เติมน้ำมันและเผื่อเวลาตรวจรถก่อนคืน")]),
        .init(date: "2026-11-27", title: "Hakata & Tenjin", city: "Fukuoka", items: [
            ("activity", "Tochoji Temple", "Tochoji Temple", nil, nil),
            ("shopping", "Tenjin Underground Mall", "Tenjin Chikagai", nil, nil),
            ("shopping", "Canal City final shopping", "Canal City Hakata", nil, "จัด tax-free และแพ็กกระเป๋า"),
            ("hotel", "JR Kyushu Hotel Blossom Hakata Chuo", "2-2-11 Hakataekimae, Hakata-ku", nil, "ย้ายที่พัก · Superior Twin ×2 ห้อง · Pay at hotel")]),
        .init(date: "2026-11-28", title: "Departure", city: "Fukuoka", items: [
            ("hotel", "เช็กเอาต์ Blossom Hakata Chuo", "JR Kyushu Hotel Blossom Hakata Chuo", nil, "ออกเช้าและเผื่อเวลาเดินทางสนามบิน"),
            ("flight", "เดินทางกลับไทย", "Fukuoka Airport", "11:00", "เที่ยวบิน 11:00 น. · ถึงสนามบินก่อนเวลาอย่างน้อย 2.5–3 ชั่วโมง")])
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
        VStack(spacing: 6) { Image(systemName: icon).foregroundColor(.brand400); Text(value).font(.system(size: 14, weight: .bold)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.7); Text(label).font(.system(size: 10)).foregroundColor(Color(hex: "#94A3B8")) }
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
    /// Shown under the picture in the full-screen viewer.
    var name: String? = nil

    @State private var showViewer = false

    private var imageURL: URL? { url.flatMap { URL(string: $0) } }

    var body: some View {
        ZStack {
            if let imageURL {
                AsyncImage(url: imageURL) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { fallback }
                }
            } else { fallback }
        }
        .frame(width: 31, height: 31)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color(hex: "#0E1527"), lineWidth: 2))
        // Only a real photo can be enlarged; an initials badge has nothing more to show.
        .contentShape(Circle())
        .onTapGesture { if imageURL != nil { hapticLight(); showViewer = true } }
        .fullScreenCover(isPresented: $showViewer) {
            if let imageURL { ProfileImageViewer(url: imageURL, title: name) }
        }
    }

    private var fallback: some View {
        Text(initials.uppercased())
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(tint)
    }
}

/// A reusable visual-diary tile (a bundled mood image or one of the team's photos).
private struct KyushuMomentCard: View {
    let item: PagerItem
    let accent: Color

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color(hex: "#151D32")
                .overlay(photo)
                .clipped()
            LinearGradient(colors: [.clear, Color(hex: "#071126").opacity(0.92)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title ?? "Trip photo").font(.system(size: 14, weight: .bold)).foregroundColor(.white).lineLimit(1)
                if let subtitle = item.subtitle {
                    Text(subtitle).font(.system(size: 10, weight: .medium)).foregroundColor(.white.opacity(0.82)).lineLimit(1)
                }
            }
            .padding(12)
        }
        .frame(width: 208, height: 142)
        .clipShape(RoundedRectangle(cornerRadius: 15))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(accent.opacity(0.75), lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 15))
    }

    @ViewBuilder private var photo: some View {
        switch item {
        case .asset(let name, _, _):
            Image(name).resizable().scaledToFill()
        case .remote(let url, _):
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { ProgressView().tint(.white) }
            }
        }
    }
}

private struct KyushuCrewBadge: View {
    let crew: KyushuCrew
    let avatarURL: URL?

    var body: some View {
        VStack(spacing: 3) {
            Color.clear
                .frame(width: 68, height: 68)
                .overlay(portrait)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.brand300.opacity(0.65), lineWidth: 1.5))
                .frame(maxWidth: .infinity)
            Text(crew.name).font(.system(size: 10, weight: .bold)).foregroundColor(.white).lineLimit(1)
            Text(crew.role).font(.system(size: 8, weight: .medium)).foregroundColor(Color(hex: "#94A3B8")).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var portrait: some View {
        if let avatarURL {
            AsyncImage(url: avatarURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { Image(crew.imageName).resizable().scaledToFill() }
            }
        } else {
            Image(crew.imageName).resizable().scaledToFill()
        }
    }
}

private struct KyushuMascotIdentityTag: View {
    let imageName: String
    let imageURL: URL?
    let name: String
    let animal: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Color(hex: "#181F3A")
                .frame(width: 104, height: 104)
                .overlay(picture)
                .clipShape(RoundedRectangle(cornerRadius: 13))
            Text(name).font(.system(size: 11, weight: .bold)).foregroundColor(.white).lineLimit(1)
            Text(animal).font(.system(size: 9, weight: .medium)).foregroundColor(.brand300).lineLimit(1)
        }
        .padding(9)
        .frame(width: 122, alignment: .leading)
        .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 16))
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder private var picture: some View {
        if let imageURL {
            AsyncImage(url: imageURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { Image(imageName).resizable().scaledToFit() }
            }
        } else {
            Image(imageName).resizable().scaledToFit()
        }
    }
}

private struct SharedTripProfileBadge: View {
    let member: TripParticipant

    var body: some View {
        HStack(spacing: 7) {
            TripProfileAvatar(url: member.avatarUrl, initials: String(member.displayName.prefix(1)), enlargeable: true, name: member.displayName)
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
    /// Tap to open the picture full screen. Off by default because most uses
    /// sit inside a Button (e.g. the member list rows) that already owns the tap.
    var enlargeable = false
    var name: String? = nil

    @State private var showViewer = false

    private var remote: URL? { url.flatMap { URL(string: $0) } }

    var body: some View {
        Group {
            if let remote {
                AsyncImage(url: remote) { image in image.resizable().scaledToFill() } placeholder: { avatarFallback }
            } else { avatarFallback }
        }
        .frame(width: 46, height: 46).clipShape(Circle())
        .contentShape(Circle())
        .onTapGesture { if enlargeable, remote != nil { hapticLight(); showViewer = true } }
        .fullScreenCover(isPresented: $showViewer) {
            if let remote { ProfileImageViewer(url: remote, title: name) }
        }
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

// MARK: – Trip page: crew, identity tags, viewers and detail sheets

/// One of the four travellers on the Kyushu trip card. `aliases` (lower-case)
/// tie the card to a real trip participant by display name.
private struct KyushuCrew: Identifiable, Hashable {
    let id: String
    let imageName: String
    let name: String
    let role: String
    let mascotImage: String
    let animal: String
    let aliases: [String]
}

private let kyushuCrew: [KyushuCrew] = [
    .init(id: "tom", imageName: "KyushuDrTom", name: "Dr. Tom", role: "Mentor",
          mascotImage: "KyushuMascotTom", animal: "Shiba Inu", aliases: ["tom", "ทอม", "ชายนิมิต"]),
    .init(id: "joey", imageName: "KyushuDrJoey", name: "Dr. Joey", role: "Navigator",
          mascotImage: "KyushuMascotJoey", animal: "Wise Owl", aliases: ["joey", "โจ้"]),
    .init(id: "nancy", imageName: "KyushuNancy", name: "Nancy", role: "Planner",
          mascotImage: "KyushuMascotNancy", animal: "Red Panda", aliases: ["nancy", "แนน"]),
    .init(id: "vivi", imageName: "KyushuVivi", name: "Vivi", role: "Story",
          mascotImage: "KyushuMascotVivi", animal: "Lucky Rabbit", aliases: ["vivi", "วิ"]),
]

private struct IdentityTagState {
    let name: String
    let animal: String
    let imageURL: URL?
    let isCustomImage: Bool
}

private enum PagerItem {
    case asset(name: String, title: String, subtitle: String)
    case remote(url: URL, title: String?)

    var title: String? {
        switch self {
        case .asset(_, let title, _): return title
        case .remote(_, let title): return title
        }
    }
    var subtitle: String? {
        if case .asset(_, _, let subtitle) = self { return subtitle }
        return nil
    }
}

private struct PagerRequest: Identifiable {
    let id = UUID()
    let items: [PagerItem]
    let start: Int
}

private struct MomentRequest: Identifiable {
    let id = UUID()
    let day: TripItineraryDay?
    let imageName: String
}

/// Re-encodes a picked photo as a JPEG no larger than `maxSide` on its long
/// edge, so a 12 MP library photo does not become a 6 MB upload.
private func downscaledJPEG(_ data: Data, maxSide: CGFloat = 2000, quality: CGFloat = 0.82) -> Data? {
    guard let image = UIImage(data: data) else { return nil }
    let longest = max(image.size.width, image.size.height)
    guard longest > maxSide else { return image.jpegData(compressionQuality: quality) }
    let ratio = maxSide / longest
    let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
    let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return resized.jpegData(compressionQuality: quality)
}

/// Full-screen view of the trip's background with a way to replace it.
private struct CoverViewerSheet: View {
    let url: URL?
    let onPick: (Data) async throws -> Void
    let onReset: () async throws -> Void

    @State private var pick: PhotosPickerItem?
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ProfileImageViewer(url: url, assetName: url == nil ? "KyushuTripCover" : nil,
                           title: busy ? "กำลังอัปโหลด…" : message) {
            HStack(spacing: 10) {
                PhotosPicker(selection: $pick, matching: .images) {
                    Label("เปลี่ยนรูปพื้นหลัง", systemImage: "photo.badge.plus")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Color.brand500, in: Capsule())
                }
                .disabled(busy)
                if url != nil {
                    Button {
                        Task {
                            busy = true; defer { busy = false }
                            do { try await onReset(); message = nil } catch { message = error.localizedDescription }
                        }
                    } label: {
                        Label("ใช้รูปเริ่มต้น", systemImage: "arrow.uturn.backward")
                            .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(.white.opacity(0.18), in: Capsule())
                    }
                    .disabled(busy)
                }
            }
        }
        .onChange(of: pick) { _, item in
            guard let item else { return }
            Task {
                busy = true
                defer { busy = false; pick = nil }
                guard let raw = try? await item.loadTransferable(type: Data.self),
                      let jpeg = downscaledJPEG(raw) else { message = "อ่านรูปไม่สำเร็จ"; return }
                do { try await onPick(jpeg); message = nil } catch { message = error.localizedDescription }
            }
        }
    }
}

/// The "next moment" photo, enlarged, with the day's details underneath.
private struct MomentDetailSheet: View {
    let request: MomentRequest
    let onOpenPlan: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var showImage = false

    private func icon(_ type: String) -> String {
        switch type {
        case "meal": return "fork.knife"
        case "hotel": return "bed.double.fill"
        case "shinkansen", "transport": return "tram.fill"
        case "car_rental": return "car.fill"
        case "flight": return "airplane"
        case "shopping": return "bag.fill"
        case "booking": return "ticket.fill"
        default: return "sparkles"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Color(hex: "#151D32")
                        .frame(height: 240)
                        .overlay(Image(request.imageName).resizable().scaledToFill())
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                .frame(width: 30, height: 30).background(.black.opacity(0.45), in: Circle())
                                .padding(10)
                        }
                        .onTapGesture { showImage = true }

                    if let day = request.day {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("NEXT KYUSHU MOMENT").font(.system(size: 10, weight: .bold)).tracking(0.9).foregroundColor(.brand300)
                            Text(day.title ?? "วันที่ \(day.dayNumber)")
                                .font(.system(size: 22, weight: .bold)).foregroundColor(.white)
                            Text([ "วันที่ \(day.dayNumber)", day.date, day.city ].compactMap { $0 }.joined(separator: " · "))
                                .font(.system(size: 12)).foregroundColor(Color(hex: "#9CA9C4"))
                            if let summary = day.summary, !summary.isEmpty {
                                Text(summary).font(.system(size: 13)).foregroundColor(Color(hex: "#C9D3E8"))
                            }
                        }

                        VStack(spacing: 8) {
                            ForEach(day.items ?? []) { item in
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: icon(item.type)).foregroundColor(.brand300).frame(width: 24)
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            if let time = item.timeFrom { Text(String(time.prefix(5))).font(.system(size: 11, weight: .bold)).foregroundColor(.brand300) }
                                            Text(item.title).font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                                        }
                                        if let place = item.location, !place.isEmpty {
                                            Text(place).font(.system(size: 11)).foregroundColor(Color(hex: "#9CA9C4"))
                                        }
                                        if let notes = item.notes, !notes.isEmpty {
                                            Text(notes).font(.system(size: 11)).foregroundColor(Color(hex: "#C9D3E8"))
                                        }
                                        if let code = item.confirmationCode, !code.isEmpty {
                                            Text("Confirmation \(code)").font(.system(size: 10, weight: .medium)).foregroundColor(.brand300)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(11)
                                .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 13))
                            }
                        }
                        Button { onOpenPlan() } label: {
                            Label("เปิดแผนทั้งหมด", systemImage: "calendar")
                                .font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                                .frame(maxWidth: .infinity).padding(13)
                                .background(Color.brand500, in: RoundedRectangle(cornerRadius: 14))
                        }
                    } else {
                        Text("ยังไม่มีแผนเดินทาง").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                        Text("เพิ่มวันแรกในแท็บแผน แล้วรายละเอียดของวันจะแสดงที่นี่")
                            .font(.system(size: 13)).foregroundColor(Color(hex: "#9CA9C4"))
                    }
                }
                .padding(16)
            }
            .background(Color(hex: "#080C1A").ignoresSafeArea())
            .navigationTitle("รายละเอียดทริป").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("ปิด") { dismiss() } } }
            .fullScreenCover(isPresented: $showImage) {
                ProfileImageViewer(assetName: request.imageName, title: request.day?.title)
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// A traveller's profile page: the photo (tap for full screen), their role, and
/// editing of the photo, name, role and share setting.
private struct CrewProfileSheet: View {
    let crew: KyushuCrew
    let participant: TripParticipant?
    let avatarURL: URL?
    let save: (String, String, String?, String?, Data?, Bool) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showViewer = false
    @State private var editing: TripParticipant?

    private var role: String { participant?.tripRole.flatMap { $0.isEmpty ? nil : $0 } ?? crew.role }
    private var displayName: String { participant?.displayName ?? crew.name }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Color(hex: "#151D32")
                        .frame(width: 190, height: 190)
                        .overlay(portrait)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color.brand300.opacity(0.7), lineWidth: 2))
                        .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                .frame(width: 32, height: 32).background(Color.brand500, in: Circle())
                        }
                        .onTapGesture { showViewer = true }
                        .padding(.top, 8)

                    VStack(spacing: 4) {
                        Text(crew.name).font(.system(size: 24, weight: .bold)).foregroundColor(.white)
                        if displayName != crew.name {
                            Text(displayName).font(.system(size: 13)).foregroundColor(Color(hex: "#9CA9C4"))
                        }
                        Text(role).font(.system(size: 12, weight: .semibold)).foregroundColor(.brand300)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(Color.brand500.opacity(0.18), in: Capsule())
                    }

                    if let participant {
                        VStack(alignment: .leading, spacing: 10) {
                            infoRow("person.crop.circle", participant.isHost ? "Host ของทริป" : "ผู้ร่วมเดินทาง")
                            infoRow(participant.profileSharedWithTrip ? "eye.fill" : "eye.slash.fill",
                                    participant.profileSharedWithTrip ? "แชร์รูปและบทบาทให้ทีม" : "รูปและบทบาทแสดงเฉพาะเจ้าของ/โฮสต์")
                        }
                        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 15))

                        Button { editing = participant } label: {
                            Label("เปลี่ยนรูป / แก้ไข Profile", systemImage: "pencil.circle.fill")
                                .font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                                .frame(maxWidth: .infinity).padding(13)
                                .background(Color.brand500, in: RoundedRectangle(cornerRadius: 14))
                        }
                    } else {
                        Text("ยังไม่พบสมาชิกในทริปที่ตรงกับ \(crew.name) — เพิ่มสมาชิกที่แท็บทีมก่อน จึงจะเปลี่ยนรูปหรือแก้ไข Profile ได้")
                            .font(.system(size: 12)).foregroundColor(Color(hex: "#9CA9C4"))
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: "#151D32"), in: RoundedRectangle(cornerRadius: 15))
                    }
                }
                .padding(16)
            }
            .background(Color(hex: "#080C1A").ignoresSafeArea())
            .navigationTitle("Profile").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("ปิด") { dismiss() } } }
            .fullScreenCover(isPresented: $showViewer) {
                if let avatarURL { ProfileImageViewer(url: avatarURL, title: crew.name) }
                else { ProfileImageViewer(assetName: crew.imageName, title: crew.name) }
            }
            .sheet(item: $editing) { member in
                TripProfileEditorSheet(member: member, save: save)
            }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var portrait: some View {
        if let avatarURL {
            AsyncImage(url: avatarURL) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { Image(crew.imageName).resizable().scaledToFill() }
            }
        } else {
            Image(crew.imageName).resizable().scaledToFill()
        }
    }

    private func infoRow(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundColor(.brand300).frame(width: 22)
            Text(text).font(.system(size: 13)).foregroundColor(.white)
            Spacer(minLength: 0)
        }
    }
}

/// An identity tag, enlarged, with its name, animal and picture editable.
private struct IdentityTagSheet: View {
    let crew: KyushuCrew
    let state: IdentityTagState
    let save: (String, String, Data?) async throws -> Void
    let reset: () async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var animal: String
    @State private var pick: PhotosPickerItem?
    @State private var picked: UIImage?
    @State private var pickedData: Data?
    @State private var showViewer = false
    @State private var saving = false
    @State private var errorText: String?

    init(crew: KyushuCrew, state: IdentityTagState,
         save: @escaping (String, String, Data?) async throws -> Void,
         reset: @escaping () async throws -> Void) {
        self.crew = crew
        self.state = state
        self.save = save
        self.reset = reset
        _name = State(initialValue: state.name)
        _animal = State(initialValue: state.animal)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Spacer()
                        Color(hex: "#181F3A")
                            .frame(width: 220, height: 220)
                            .overlay(picture)
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: "arrow.up.left.and.arrow.down.right")
                                    .font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                                    .frame(width: 30, height: 30).background(.black.opacity(0.5), in: Circle())
                                    .padding(8)
                            }
                            .onTapGesture { showViewer = true }
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    PhotosPicker(selection: $pick, matching: .images) {
                        Label("เปลี่ยนรูปแท็ก", systemImage: "photo.badge.plus")
                    }
                    if state.isCustomImage || pickedData != nil {
                        Button("กลับไปใช้รูปเริ่มต้น", role: .destructive) {
                            Task {
                                saving = true; defer { saving = false }
                                do { try await reset(); dismiss() } catch { errorText = error.localizedDescription }
                            }
                        }
                    }
                }
                Section("ข้อมูลแท็ก") {
                    TextField("ชื่อบนแท็ก", text: $name)
                    TextField("สัตว์ประจำตัว", text: $animal)
                }
                if let errorText { Section { Text(errorText).foregroundColor(.red) } }
            }
            .navigationTitle("Identity tag").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "กำลังบันทึก…" : "บันทึก") {
                        Task {
                            saving = true; defer { saving = false }
                            do {
                                try await save(name.trimmingCharacters(in: .whitespacesAndNewlines),
                                               animal.trimmingCharacters(in: .whitespacesAndNewlines), pickedData)
                                dismiss()
                            } catch { errorText = error.localizedDescription }
                        }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .fullScreenCover(isPresented: $showViewer) {
                if let picked { PickedImageViewer(image: picked, title: name) }
                else if let url = state.imageURL { ProfileImageViewer(url: url, title: name) }
                else { ProfileImageViewer(assetName: crew.mascotImage, title: name) }
            }
            .onChange(of: pick) { _, item in
                Task {
                    guard let raw = try? await item?.loadTransferable(type: Data.self),
                          let jpeg = downscaledJPEG(raw, maxSide: 1400), let image = UIImage(data: jpeg) else { return }
                    picked = image
                    pickedData = jpeg
                }
            }
        }
    }

    @ViewBuilder private var picture: some View {
        if let picked {
            Image(uiImage: picked).resizable().scaledToFit()
        } else if let url = state.imageURL {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFit() }
                else { Image(crew.mascotImage).resizable().scaledToFit() }
            }
        } else {
            Image(crew.mascotImage).resizable().scaledToFit()
        }
    }
}

/// Full-screen zoomable view of an image that is still only in memory.
private struct PickedImageViewer: View {
    let image: UIImage
    let title: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            ZoomableImage(image: image)
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 30))
                    .symbolRenderingMode(.palette).foregroundStyle(.white, .white.opacity(0.28))
            }
            .padding(16)
        }
    }
}

/// Swipe through the gallery images, one per page.
private struct TripImagePager: View {
    let items: [PagerItem]
    @State private var index: Int
    @Environment(\.dismiss) private var dismiss

    init(items: [PagerItem], start: Int) {
        self.items = items
        _index = State(initialValue: min(max(start, 0), max(items.count - 1, 0)))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(items.enumerated()), id: \.offset) { position, item in
                    page(item).tag(position)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            .ignoresSafeArea()

            VStack {
                HStack {
                    Text("\(index + 1) / \(items.count)")
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 5).background(.black.opacity(0.45), in: Capsule())
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 30))
                            .symbolRenderingMode(.palette).foregroundStyle(.white, .white.opacity(0.28))
                    }
                }
                .padding(.horizontal, 16).padding(.top, 8)
                Spacer()
                if items.indices.contains(index) {
                    VStack(spacing: 3) {
                        if let title = items[index].title, !title.isEmpty {
                            Text(title).font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                        }
                        if let subtitle = items[index].subtitle {
                            Text(subtitle).font(.system(size: 12)).foregroundColor(.white.opacity(0.8))
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
                    .padding(.bottom, 44)
                }
            }
        }
    }

    @ViewBuilder private func page(_ item: PagerItem) -> some View {
        switch item {
        case .asset(let name, _, _):
            Image(name).resizable().scaledToFit()
        case .remote(let url, _):
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFit() }
                else if phase.error != nil { Image(systemName: "photo.badge.exclamationmark").font(.system(size: 40)).foregroundColor(.white.opacity(0.7)) }
                else { ProgressView().tint(.white) }
            }
        }
    }
}
