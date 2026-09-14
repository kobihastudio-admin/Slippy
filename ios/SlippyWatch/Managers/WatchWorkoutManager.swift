import Foundation
import HealthKit
import Combine

final class WatchWorkoutManager: NSObject, ObservableObject {
    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    @Published var isRunning = false
    @Published var isPaused  = false
    @Published var heartRate: Int    = 0
    /// True running average/max over the whole session, from HealthKit's own
    /// accumulated statistics (not a single instantaneous reading) — read
    /// these at session end instead of `heartRate`, which is just "right now".
    @Published var avgHeartRate: Int = 0
    @Published var maxHeartRate: Int = 0
    @Published var activeCalories: Double = 0
    @Published var elapsedSeconds: Int    = 0

    private var timer: Timer?

    var sessionStartDate: Date?

    // MARK: – Permissions

    func requestAuthorization() {
        let types: Set<HKSampleType> = [
            HKObjectType.workoutType(),
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        ]
        store.requestAuthorization(toShare: types, read: types) { _, _ in }
    }

    // MARK: – Start

    func startSession(sport: SlippySport = .badminton) {
        let config = HKWorkoutConfiguration()
        config.activityType = Self.activityType(for: sport)
        config.locationType = .indoor

        do {
            session = try HKWorkoutSession(healthStore: store, configuration: config)
            builder = session?.associatedWorkoutBuilder()
            builder?.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)

            session?.delegate  = self
            builder?.delegate  = self

            let startDate = Date()
            sessionStartDate = startDate
            session?.startActivity(with: startDate)
            builder?.beginCollection(withStart: startDate) { [weak self] _, _ in
                DispatchQueue.main.async {
                    self?.isRunning = true
                    self?.startTimer()
                }
            }
        } catch {
            print("WatchWorkoutManager: startSession error \(error)")
        }
    }

    // MARK: – Pause / Resume

    func pauseSession() {
        session?.pause()
        timer?.invalidate()
        isPaused = true
    }

    func resumeSession() {
        session?.resume()
        startTimer()
        isPaused = false
    }

    // MARK: – End

    func endSession(completion: @escaping (Int, Double) -> Void) {
        session?.end()
        timer?.invalidate()
        builder?.endCollection(withEnd: Date()) { [weak self] _, _ in
            self?.builder?.finishWorkout { workout, _ in
                let calories = workout?.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
                let elapsed  = Int(workout?.duration ?? 0)
                DispatchQueue.main.async {
                    self?.isRunning = false
                    self?.isPaused  = false
                    completion(elapsed, calories)
                }
            }
        }
    }

    // MARK: – Timer

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.elapsedSeconds += 1
        }
    }

    // MARK: – Live metrics parser

    private func updateMetrics(statistics: HKStatistics) {
        switch statistics.quantityType {
        case HKObjectType.quantityType(forIdentifier: .heartRate):
            let unit = HKUnit(from: "count/min")
            // Heart rate's aggregation style is discreteArithmetic, so the
            // builder accumulates average/min/max over the whole session —
            // not just the most recent sample — for free.
            let bpm = statistics.mostRecentQuantity()?.doubleValue(for: unit) ?? 0
            let avg = statistics.averageQuantity()?.doubleValue(for: unit)
            let max = statistics.maximumQuantity()?.doubleValue(for: unit)
            DispatchQueue.main.async {
                self.heartRate = Int(bpm)
                if let avg { self.avgHeartRate = Int(avg) }
                if let max { self.maxHeartRate = Int(max) }
            }
        case HKObjectType.quantityType(forIdentifier: .activeEnergyBurned):
            let kcal = statistics.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
            DispatchQueue.main.async { self.activeCalories = kcal }
        default: break
        }
    }

    // MARK: – Sport → HealthKit activity type

    private static func activityType(for sport: SlippySport) -> HKWorkoutActivityType {
        switch sport {
        case .badminton:
            if #available(watchOS 8.0, *) { return .badminton } else { return .other }
        case .tennis:      return .tennis
        case .tableTennis: return .tableTennis
        case .squash:      return .squash
        case .general:     return .other
        }
    }
}

extension WatchWorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession,
                        didChangeTo toState: HKWorkoutSessionState,
                        from fromState: HKWorkoutSessionState,
                        date: Date) {}
    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {}
}

extension WatchWorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                        didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let qType = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: qType) else { continue }
            updateMetrics(statistics: stats)
        }
    }
}
