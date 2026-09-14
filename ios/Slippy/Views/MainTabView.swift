import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var tabRouter = TabRouter()
    @State private var showCamera  = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch tabRouter.selected {
                case 0: DashboardView()
                case 1: SplitView()
                case 2: PlayDashboardView()
                case 3: MoreMenuView()
                default: DashboardView()
                }
            }
            .environmentObject(authVM)
            .environmentObject(tabRouter)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            customTabBar
        }
        .ignoresSafeArea(edges: .bottom)
        .sheet(isPresented: $showCamera) {
            // Land on หน้าหลัก afterwards: that is where the processing banner
            // and the rejection alert live, so anything the upload has to say
            // is already on screen when the sheet closes.
            CameraPickerView(onUploadSuccess: { tabRouter.selected = 0 })
                .environmentObject(authVM)
        }
    }

    // MARK: – Custom tab bar
    // หน้าหลัก | หารบิล | [📸สแกนสลิป] | นัดกีฬา | เพิ่มเติม
    // "เพิ่มเติม" keeps the same rightmost slot "โซเชียล" used to occupy —
    // Social is now reachable one tap further in, via the More hub, which
    // also surfaces Health/Trips/Tax/Vendors/Billing that previously had no
    // tab-level entry point anywhere in the app.
    private var customTabBar: some View {
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 28)
                .fill(Color.surface)
                .shadow(color: .black.opacity(0.1), radius: 16, x: 0, y: -4)
                .frame(height: 72)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

            HStack(alignment: .bottom, spacing: 0) {
                tabItem(icon: "house.fill",    label: "หน้าหลัก", tag: 0)
                tabItem(icon: "person.2.fill", label: "หารบิล",   tag: 1)

                // Raised center scan button
                Button {
                    hapticLight()
                    showCamera = true
                } label: {
                    VStack(spacing: 4) {
                        ZStack {
                            Circle()
                                .fill(LinearGradient(
                                    colors: [Color(hex: "#7c72f5"), Color(hex: "#6366f1")],
                                    startPoint: .topLeading, endPoint: .bottomTrailing
                                ))
                                .frame(width: 56, height: 56)
                                .shadow(color: Color(hex: "#6366f1").opacity(0.45), radius: 12, x: 0, y: 6)
                            Image(systemName: "camera.viewfinder")
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundColor(.white)
                        }
                        .offset(y: -18)
                        Text("สแกนสลิป")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(Color.brand500)
                            .offset(y: -16)
                    }
                }
                .frame(maxWidth: .infinity)

                tabItem(icon: "sportscourt.fill",       label: "นัดกีฬา",  tag: 2)
                tabItem(icon: "square.grid.2x2.fill",   label: "เพิ่มเติม", tag: 3)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 32)
        }
    }

    private func tabItem(icon: String, label: String, tag: Int) -> some View {
        let active = tabRouter.selected == tag
        return Button {
            hapticLight()
            tabRouter.selected = tag
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: active ? .bold : .regular))
                    .foregroundColor(active ? Color.brand500 : Color.textSecondary)
                    .scaleEffect(active ? 1.1 : 1)
                    .animation(.spring(response: 0.25), value: tabRouter.selected)
                Text(label)
                    .font(.system(size: 10, weight: active ? .semibold : .regular))
                    .foregroundColor(active ? Color.brand500 : Color.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 4)
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
    return MainTabView().environmentObject(vm)
}
#endif
